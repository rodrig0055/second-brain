import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, socialPostDrafts } from "@/db/schema";
import { validateDraft as checkDraft } from "@/lib/social/validate";
import { unixSeconds } from "@/lib/social/time";
import {
  createIgComment,
  createIgContainer,
  fetchIgContainerStatus,
  fetchIgPublishQuota,
  findRecentIgMedia,
  publishIgContainer,
  publishPagePost,
  resolveOrganicTarget,
  waitForIgContainer,
  type OrganicTarget,
} from "./client";

export type SocialDraft = typeof socialPostDrafts.$inferSelect;

/**
 * The publish path. Nothing else in the app calls Meta's write endpoints.
 *
 * Not reachable from a tool: the agent's `socialDraftPost` inserts a row and
 * returns. Only the publish actions get here, and only after a named person
 * clicked Publish on a specific draft.
 *
 * The hard part is not publishing, it is publishing exactly once. An Instagram
 * post is two calls — create a container, then publish it — with a poll in
 * between that can run for two minutes on a video. A request that dies in that
 * gap used to leave a row no UI could touch. Now the container id is written
 * down before the poll starts, so a retry finishes the publish in flight
 * instead of starting a second one.
 */

/** Re-exported so existing callers keep working; the rules live in one place. */
export function validateDraft(draft: SocialDraft, target: OrganicTarget): string | null {
  return checkDraft(
    {
      channel: draft.channel,
      mediaType: draft.mediaType,
      caption: draft.caption,
      mediaUrls: draft.mediaUrls,
      linkUrl: draft.linkUrl,
      firstComment: draft.firstComment,
      // Already-set schedules are Meta's problem now, not ours to re-validate.
      scheduledAt: null,
    },
    target,
  );
}

/** Told what we learned mid-publish, so a dead request is resumable. */
export type ContainerSink = (state: {
  containerId: string | null;
  children?: string[];
}) => Promise<void>;

export type PublishOptions = {
  onContainer?: ContainerSink;
  /** Unix seconds. Facebook only; Meta holds and publishes the post. */
  scheduledPublishTime?: number;
};

async function publishToInstagram(
  target: OrganicTarget,
  draft: SocialDraft,
  onContainer?: ContainerSink,
): Promise<{ id: string; permalink: string }> {
  const caption = draft.caption;

  // Resume: a container from a previous attempt is still valid for 24h, so
  // finish it rather than creating another post.
  if (draft.igContainerId) {
    const status = await fetchIgContainerStatus(target, draft.igContainerId).catch(() => null);
    if (status?.code === "FINISHED") {
      return publishIgContainer(target, draft.igContainerId);
    }
    if (status?.code === "IN_PROGRESS") {
      await waitForIgContainer(target, draft.igContainerId);
      return publishIgContainer(target, draft.igContainerId);
    }
    if (status?.code === "PUBLISHED") {
      // Meta published it and we died before writing the id down. Recover it
      // rather than posting twice; if we cannot, say so and stop.
      const since = (draft.claimedAt ?? draft.updatedAt ?? new Date()).getTime() - 15 * 60_000;
      const found = await findRecentIgMedia(target, { caption, sinceMs: since });
      if (found) return found;
      throw new Error(
        "Instagram reports this post as already published, but its media id could not be recovered. " +
          "Check the account before retrying, or this will post twice.",
      );
    }
    // ERROR or EXPIRED: that container is dead, start again.
    await onContainer?.({ containerId: null, children: [] });
  }

  if (draft.mediaType === "carousel") {
    // Children are created first, each as its own container, then bound into
    // one carousel container. Captions belong on the parent only. Children are
    // recorded as they are made so a resume does not re-upload them.
    const children: string[] = [...(draft.igContainerChildren ?? [])];
    for (const url of draft.mediaUrls.slice(children.length)) {
      const isVideo = /\.(mp4|mov)(\?|$)/i.test(url);
      const child = await createIgContainer(target, {
        [isVideo ? "videoUrl" : "imageUrl"]: url,
        isCarouselItem: true,
      });
      children.push(child);
      await onContainer?.({ containerId: null, children });
      await waitForIgContainer(target, child);
    }
    const parent = await createIgContainer(target, { caption, children, mediaType: "CAROUSEL" });
    await onContainer?.({ containerId: parent, children });
    await waitForIgContainer(target, parent);
    return publishIgContainer(target, parent);
  }

  const url = draft.mediaUrls[0]!;
  const container =
    draft.mediaType === "video"
      ? // Single videos publish as Reels; Meta retired the plain VIDEO product
        // type for feed publishing, so REELS is the only working path.
        await createIgContainer(target, { videoUrl: url, caption, mediaType: "REELS" })
      : await createIgContainer(target, { imageUrl: url, caption });

  // Written down BEFORE the wait. The wait is where the request dies.
  await onContainer?.({ containerId: container });
  await waitForIgContainer(target, container);
  return publishIgContainer(target, container);
}

export type PublishOutcome = {
  igMediaId: string | null;
  fbPostId: string | null;
  permalink: string | null;
  firstCommentId: string | null;
  /** Set when Meta is holding the Facebook post rather than having published it. */
  scheduled: boolean;
  /** Set when at least one target failed. The draft is only `published` if null. */
  error: string | null;
  /** Non-fatal: the post is up, but something beside it did not happen. */
  warnings: string[];
};

/**
 * Push one claimed draft to Meta.
 *
 * `both` is two independent API calls, so one side can succeed while the other
 * fails. When that happens the succeeded id is still recorded and the error
 * names which side failed, because reporting the whole draft as failed invites
 * someone to retry and double-post the half that worked.
 */
export async function publishDraft(
  draft: SocialDraft,
  options: PublishOptions = {},
): Promise<PublishOutcome> {
  const empty: PublishOutcome = {
    igMediaId: draft.igMediaId,
    fbPostId: draft.fbPostId,
    permalink: draft.permalink,
    firstCommentId: draft.firstCommentId,
    scheduled: false,
    error: null,
    warnings: [],
  };

  const conn = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, draft.brandId),
      eq(integrationConnections.platform, "meta_organic"),
      eq(integrationConnections.status, "connected"),
    ),
  });
  if (!conn) {
    return { ...empty, error: "No connected Meta organic account for this brand." };
  }

  const target = resolveOrganicTarget(conn);
  const invalid = validateDraft(draft, target);
  if (invalid) return { ...empty, error: invalid };

  // A retry after a partial cross-post must not re-publish the half that
  // worked, so an id already on the row means that side is done.
  const wantsIg =
    (draft.channel === "instagram" || draft.channel === "both") && !draft.igMediaId;
  const wantsFb =
    (draft.channel === "facebook" || draft.channel === "both") && !draft.fbPostId;

  if (!wantsIg && !wantsFb) return empty;

  if (wantsIg) {
    const quota = await fetchIgPublishQuota(target).catch(() => null);
    if (quota && quota.total > 0 && quota.used >= quota.total) {
      return {
        ...empty,
        error: `Instagram's 24h publish quota is used up (${quota.used}/${quota.total}). Try again later.`,
      };
    }
  }

  let igMediaId: string | null = draft.igMediaId;
  let fbPostId: string | null = draft.fbPostId;
  let permalink: string | null = draft.permalink;
  let firstCommentId: string | null = draft.firstCommentId;
  let scheduled = false;
  const failures: string[] = [];
  const warnings: string[] = [];

  if (wantsIg) {
    try {
      const r = await publishToInstagram(target, draft, options.onContainer);
      igMediaId = r.id;
      permalink = r.permalink || permalink;

      // Hashtags usually live here. The post is already up, so a failure is a
      // note beside it, never a reason to call the whole thing failed.
      if (draft.firstComment.trim()) {
        try {
          firstCommentId = await createIgComment(target, r.id, draft.firstComment);
        } catch (err) {
          warnings.push(
            `First comment was not posted: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      failures.push(`Instagram: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (wantsFb) {
    try {
      const r = await publishPagePost(target, {
        message: draft.caption,
        link: draft.linkUrl ?? undefined,
        imageUrl: draft.mediaUrls[0],
        altText: draft.altText || undefined,
        scheduledPublishTime: options.scheduledPublishTime,
      });
      fbPostId = r.id;
      permalink = permalink || r.permalink;
      scheduled = r.scheduled;
    } catch (err) {
      failures.push(`Facebook: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    igMediaId,
    fbPostId,
    permalink,
    firstCommentId,
    scheduled,
    error: failures.length ? failures.join(" · ") : null,
    warnings,
  };
}

/** Unix seconds for a scheduled Facebook post. */
export function scheduleSeconds(at: Date): number {
  return unixSeconds(at);
}

/** Connection id for a brand's organic account, for stamping onto a draft. */
export async function organicConnectionId(brandId: string): Promise<string | null> {
  const conn = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta_organic"),
    ),
  });
  return conn?.id ?? null;
}
