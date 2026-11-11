import "server-only";

import { and, eq, inArray, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { socialPostDrafts } from "@/db/schema";
import {
  publishDraft,
  scheduleSeconds,
  type SocialDraft,
} from "@/lib/integrations/meta_organic/publish";
import {
  deletePagePost,
  fetchPagePostStatus,
  resolveOrganicTarget,
} from "@/lib/integrations/meta_organic/client";
import { integrationConnections } from "@/db/schema";
import { fbScheduleProblem } from "@/lib/social/time";
import {
  pollTiktokTask,
  publishTiktokDraft,
  tiktokConnectionFor,
  type TiktokOutcome,
} from "@/lib/integrations/tiktok_organic/publish";

/**
 * Publishing, and the states a post can be in on the way there.
 *
 *   draft ─ Publish now ─► publishing ─► published
 *     │                        └─ partial or error ─► failed ─ Retry ─┐
 *     │                                                               │
 *     ├─ Schedule on Facebook ─► scheduled (META holds it)            │
 *     │        │                                                      │
 *     │        ├─ the daily sync sees the post ─► published           │
 *     │        └─ Cancel ─► discarded                                 │
 *     └─ Discard ─► discarded ─ Restore ─► draft ◄────────────────────┘
 *
 * `scheduled` means Meta holds the post, never that we will publish it later:
 * there is no timer in this app. Facebook schedules natively; Instagram has no
 * such API, so an Instagram post is published by hand on the day it was planned
 * for.
 *
 * Claiming is a single conditional UPDATE. The Neon HTTP driver has no
 * transactions, so atomicity has to come from one statement: two people
 * pressing Publish at the same moment means the second UPDATE matches no row.
 */

/** How long a `publishing` row may sit before someone may take it over. */
const STALE_AFTER_MINUTES = 10;

export type PublishResult = {
  ok: boolean;
  message: string;
  draft: SocialDraft | null;
};

const CLAIMABLE = sql`(
  ${socialPostDrafts.status} IN ('draft', 'failed')
  OR (
    ${socialPostDrafts.status} = 'publishing'
    AND ${socialPostDrafts.claimedAt} < now() - interval '${sql.raw(String(STALE_AFTER_MINUTES))} minutes'
  )
)`;

/**
 * Take exclusive ownership of a draft, or return null because someone else has
 * it. One statement, so there is no window between checking and taking.
 */
async function claim(draftId: string, userId: string): Promise<SocialDraft | null> {
  const rows = await db
    .update(socialPostDrafts)
    .set({
      status: "publishing",
      claimedAt: new Date(),
      publishedById: userId,
      publishAttempts: sql`${socialPostDrafts.publishAttempts} + 1`,
      error: null,
      updatedAt: new Date(),
    })
    .where(and(eq(socialPostDrafts.id, draftId), CLAIMABLE))
    .returning();
  return rows[0] ?? null;
}

/** Record a container the moment Meta gives us one, before anything can die. */
function containerSink(draftId: string) {
  return async ({ containerId, children }: { containerId: string | null; children?: string[] }) => {
    await db
      .update(socialPostDrafts)
      .set({
        igContainerId: containerId,
        ...(children ? { igContainerChildren: children } : {}),
        updatedAt: new Date(),
      })
      .where(eq(socialPostDrafts.id, draftId));
  };
}

async function loadDraft(draftId: string): Promise<SocialDraft | null> {
  return (
    (await db.query.socialPostDrafts.findFirst({
      where: eq(socialPostDrafts.id, draftId),
    })) ?? null
  );
}

/**
 * Publish a draft to Meta now.
 *
 * Also the Retry and Finish publishing path: the claim admits a `failed` row
 * and a `publishing` row that has gone stale, and publishDraft skips whichever
 * half already has an id.
 */
export async function publishNow(draftId: string, userId: string): Promise<PublishResult> {
  const claimed = await claim(draftId, userId);
  if (!claimed) {
    const current = await loadDraft(draftId);
    if (!current) return { ok: false, message: "That draft no longer exists.", draft: null };
    if (current.status === "published") {
      return { ok: false, message: "This is already published.", draft: current };
    }
    if (current.status === "publishing") {
      return {
        ok: false,
        message: "Someone is publishing this right now. Give it a minute.",
        draft: current,
      };
    }
    if (current.status === "scheduled") {
      return {
        ok: false,
        message: "Facebook is holding this one. Cancel the schedule first.",
        draft: current,
      };
    }
    return { ok: false, message: "This draft cannot be published in its current state.", draft: current };
  }

  if (claimed.channel === "tiktok") return publishTiktokClaimed(claimed);

  let outcome;
  try {
    outcome = await publishDraft(claimed, { onContainer: containerSink(draftId) });
  } catch (err) {
    // publishDraft catches its own per-channel failures, so reaching here means
    // something outside them broke. The row must not stay in `publishing`.
    const message = err instanceof Error ? err.message : String(err);
    const [row] = await db
      .update(socialPostDrafts)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(socialPostDrafts.id, draftId))
      .returning();
    return { ok: false, message, draft: row ?? null };
  }

  const published = !outcome.error;
  const [row] = await db
    .update(socialPostDrafts)
    .set({
      status: published ? "published" : "failed",
      igMediaId: outcome.igMediaId,
      fbPostId: outcome.fbPostId,
      permalink: outcome.permalink,
      firstCommentId: outcome.firstCommentId,
      // Cleared on success; kept on failure so a retry can resume it.
      igContainerId: published ? null : undefined,
      error: outcome.error,
      publishedAt: published ? new Date() : undefined,
      updatedAt: new Date(),
    })
    .where(eq(socialPostDrafts.id, draftId))
    .returning();

  const warning = outcome.warnings.length ? ` ${outcome.warnings.join(" ")}` : "";
  return {
    ok: published,
    message: published ? `Published.${warning}` : (outcome.error ?? "Publishing failed."),
    draft: row ?? null,
  };
}

/** Write a TikTok task's outcome onto its draft row. */
async function applyTiktokOutcome(draftId: string, o: TiktokOutcome): Promise<SocialDraft | null> {
  const now = new Date();
  const set =
    o.state === "published"
      ? {
          status: "published" as const,
          ttPublishId: o.publishId,
          ttPostId: o.postId,
          permalink: o.permalink,
          error: null,
          publishedAt: now,
        }
      : o.state === "inbox"
        ? {
            // Handed to the account's TikTok drafts: TikTok accepted it and a
            // person finishes it in the app, so nothing here is pending.
            status: "published" as const,
            ttPublishId: o.publishId,
            error: null,
            publishedAt: now,
          }
        : o.state === "processing"
          ? { ttPublishId: o.publishId, claimedAt: now }
          : {
              status: "failed" as const,
              // A task TikTok failed is finished; clearing it lets Retry start
              // a fresh one. A failure before any task keeps nothing to clear.
              ttPublishId: null,
              error: o.error,
            };
  const [row] = await db
    .update(socialPostDrafts)
    .set({ ...set, updatedAt: now })
    .where(eq(socialPostDrafts.id, draftId))
    .returning();
  return row ?? null;
}

async function publishTiktokClaimed(claimed: SocialDraft): Promise<PublishResult> {
  let outcome: TiktokOutcome;
  try {
    outcome = await publishTiktokDraft(claimed, async (publishId) => {
      await db
        .update(socialPostDrafts)
        .set({ ttPublishId: publishId, updatedAt: new Date() })
        .where(eq(socialPostDrafts.id, claimed.id));
    });
  } catch (err) {
    // The row must not stay in `publishing`. Any task id already written stays,
    // so a retry polls it rather than posting again.
    const message = err instanceof Error ? err.message : String(err);
    const [row] = await db
      .update(socialPostDrafts)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(socialPostDrafts.id, claimed.id))
      .returning();
    return { ok: false, message, draft: row ?? null };
  }
  const draft = await applyTiktokOutcome(claimed.id, outcome);
  const message =
    outcome.state === "published"
      ? outcome.postId
        ? "Published to TikTok."
        : "Published to TikTok. The post link appears after the next sync."
      : outcome.state === "inbox"
        ? "Sent to the account's TikTok drafts. Open TikTok to post it."
        : outcome.state === "processing"
          ? "TikTok is still processing this. It will show as published once TikTok finishes."
          : outcome.error;
  return { ok: outcome.state !== "failed", message, draft };
}

/**
 * Finish TikTok tasks a publish request left behind: rows still `publishing`
 * with a task id, and published rows whose post id had not arrived yet.
 * Called by the TikTok sync, which is the only clock this app has.
 */
export async function reconcileTiktok(brandId: string): Promise<{ resolved: number }> {
  const rows = await db.query.socialPostDrafts.findMany({
    where: and(
      eq(socialPostDrafts.brandId, brandId),
      eq(socialPostDrafts.channel, "tiktok"),
      sql`${socialPostDrafts.ttPublishId} IS NOT NULL`,
      or(
        eq(socialPostDrafts.status, "publishing"),
        // Bounded: a post handed to TikTok drafts never gets a post id, and
        // without a cutoff it would be re-asked about on every sync forever.
        and(
          eq(socialPostDrafts.status, "published"),
          sql`${socialPostDrafts.ttPostId} IS NULL`,
          sql`${socialPostDrafts.publishedAt} > now() - interval '7 days'`,
        ),
      ),
    ),
  });
  let resolved = 0;
  for (const row of rows) {
    const conn = await tiktokConnectionFor(row);
    if (!conn || !row.ttPublishId) continue;
    const o = await pollTiktokTask(conn, row.ttPublishId, row.mediaType, 0).catch(() => null);
    if (!o || o.state === "processing") continue;
    // A row already published only needs its post id; never re-stamp it.
    if (row.status === "published") {
      if (o.state === "published" && o.postId) {
        await db
          .update(socialPostDrafts)
          .set({ ttPostId: o.postId, permalink: o.permalink, updatedAt: new Date() })
          .where(eq(socialPostDrafts.id, row.id));
        resolved += 1;
      }
      continue;
    }
    await applyTiktokOutcome(row.id, o);
    resolved += 1;
  }
  return { resolved };
}

/**
 * Hand a Facebook post to Meta to publish later.
 *
 * Facebook only. Instagram has no scheduling API and we run no timer, so the
 * Instagram half of a cross-post is split off as a plain draft with a planned
 * date before this is called.
 */
export async function scheduleOnFacebook(
  draftId: string,
  userId: string,
  at: Date,
): Promise<PublishResult> {
  const existing = await loadDraft(draftId);
  if (!existing) return { ok: false, message: "That draft no longer exists.", draft: null };
  if (existing.channel !== "facebook") {
    return {
      ok: false,
      message: "Only a Facebook post can be scheduled. Instagram has no scheduling API.",
      draft: existing,
    };
  }
  const problem = fbScheduleProblem(at);
  if (problem) return { ok: false, message: problem, draft: existing };

  const claimed = await claim(draftId, userId);
  if (!claimed) {
    return { ok: false, message: "This draft cannot be scheduled in its current state.", draft: existing };
  }

  let outcome;
  try {
    outcome = await publishDraft(claimed, { scheduledPublishTime: scheduleSeconds(at) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const [row] = await db
      .update(socialPostDrafts)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(socialPostDrafts.id, draftId))
      .returning();
    return { ok: false, message, draft: row ?? null };
  }

  if (outcome.error) {
    const [row] = await db
      .update(socialPostDrafts)
      .set({ status: "failed", error: outcome.error, updatedAt: new Date() })
      .where(eq(socialPostDrafts.id, draftId))
      .returning();
    return { ok: false, message: outcome.error, draft: row ?? null };
  }

  const [row] = await db
    .update(socialPostDrafts)
    .set({
      status: "scheduled",
      scheduledAt: at,
      fbPostId: outcome.fbPostId,
      permalink: outcome.permalink,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(socialPostDrafts.id, draftId))
    .returning();

  return { ok: true, message: "Facebook will publish this at the time you set.", draft: row ?? null };
}

async function organicTargetFor(brandId: string) {
  const conn = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta_organic"),
      eq(integrationConnections.status, "connected"),
    ),
  });
  return conn ? resolveOrganicTarget(conn) : null;
}

/** Take a Meta-held post back. Deletes it at Meta, then discards the row. */
export async function cancelMetaScheduled(draftId: string): Promise<PublishResult> {
  const draft = await loadDraft(draftId);
  if (!draft) return { ok: false, message: "That draft no longer exists.", draft: null };
  if (draft.status !== "scheduled" || !draft.fbPostId) {
    return { ok: false, message: "Nothing is scheduled for this draft.", draft };
  }

  const target = await organicTargetFor(draft.brandId);
  if (!target) {
    return { ok: false, message: "No connected Meta organic account for this brand.", draft };
  }

  try {
    await deletePagePost(target, draft.fbPostId);
  } catch (err) {
    // It may already have gone out. Check before telling anyone it is cancelled.
    const status = await fetchPagePostStatus(target, draft.fbPostId).catch(() => null);
    if (status?.isPublished) {
      const [row] = await db
        .update(socialPostDrafts)
        .set({
          status: "published",
          publishedAt: new Date(),
          permalink: status.permalink || draft.permalink,
          updatedAt: new Date(),
        })
        .where(eq(socialPostDrafts.id, draftId))
        .returning();
      return {
        ok: false,
        message: "Too late: Facebook already published this one.",
        draft: row ?? null,
      };
    }
    return {
      ok: false,
      message: `Could not cancel it at Meta: ${err instanceof Error ? err.message : String(err)}`,
      draft,
    };
  }

  const [row] = await db
    .update(socialPostDrafts)
    .set({
      status: "discarded",
      discardedAt: new Date(),
      scheduledAt: null,
      updatedAt: new Date(),
    })
    .where(eq(socialPostDrafts.id, draftId))
    .returning();
  return { ok: true, message: "Cancelled at Facebook.", draft: row ?? null };
}

/** Ask Meta what actually happened to a post it was holding. */
export async function verifyScheduled(draftId: string): Promise<PublishResult> {
  const draft = await loadDraft(draftId);
  if (!draft) return { ok: false, message: "That draft no longer exists.", draft: null };
  if (!draft.fbPostId) return { ok: false, message: "This draft has no Facebook post.", draft };

  const target = await organicTargetFor(draft.brandId);
  if (!target) {
    return { ok: false, message: "No connected Meta organic account for this brand.", draft };
  }

  const status = await fetchPagePostStatus(target, draft.fbPostId);
  if (!status) {
    const [row] = await db
      .update(socialPostDrafts)
      .set({
        status: "failed",
        error: "Facebook no longer has this post. It was probably deleted in Meta Business Suite.",
        updatedAt: new Date(),
      })
      .where(eq(socialPostDrafts.id, draftId))
      .returning();
    return { ok: false, message: "Facebook no longer has this post.", draft: row ?? null };
  }

  if (!status.isPublished) {
    return {
      ok: true,
      message: "Facebook still has it queued.",
      draft,
    };
  }

  const [row] = await db
    .update(socialPostDrafts)
    .set({
      status: "published",
      publishedAt: status.createdTime ? new Date(status.createdTime) : new Date(),
      permalink: status.permalink || draft.permalink,
      updatedAt: new Date(),
    })
    .where(eq(socialPostDrafts.id, draftId))
    .returning();
  return { ok: true, message: "Facebook has published it.", draft: row ?? null };
}

/**
 * Bring Meta-held posts up to date, from the daily sync.
 *
 * Anything Meta has published gets stamped; anything still queued a day after
 * its time is reported as failed, because a scheduled post that silently never
 * ran is worse than one that says so.
 */
export async function reconcileScheduled(brandId: string): Promise<{ published: number; failed: number }> {
  const held = await db.query.socialPostDrafts.findMany({
    where: and(eq(socialPostDrafts.brandId, brandId), eq(socialPostDrafts.status, "scheduled")),
  });
  if (held.length === 0) return { published: 0, failed: 0 };

  const target = await organicTargetFor(brandId);
  if (!target) return { published: 0, failed: 0 };

  let published = 0;
  let failed = 0;
  const overdue = Date.now() - 86_400_000;

  for (const row of held) {
    if (!row.fbPostId) continue;
    const status = await fetchPagePostStatus(target, row.fbPostId).catch(() => null);

    if (status?.isPublished) {
      await db
        .update(socialPostDrafts)
        .set({
          status: "published",
          publishedAt: status.createdTime ? new Date(status.createdTime) : new Date(),
          permalink: status.permalink || row.permalink,
          updatedAt: new Date(),
        })
        .where(eq(socialPostDrafts.id, row.id));
      published += 1;
      continue;
    }

    const due = row.scheduledAt?.getTime() ?? 0;
    if (due && due < overdue) {
      await db
        .update(socialPostDrafts)
        .set({
          status: "failed",
          error: status
            ? "Facebook still has this queued more than a day after its time."
            : "Facebook no longer has this post. It was probably deleted in Meta Business Suite.",
          updatedAt: new Date(),
        })
        .where(eq(socialPostDrafts.id, row.id));
      failed += 1;
    }
  }

  return { published, failed };
}

/** Rows stuck mid-publish, which the Drafts tab offers to finish. */
export async function stalledDrafts(brandIds: string[]): Promise<SocialDraft[]> {
  if (brandIds.length === 0) return [];
  return db.query.socialPostDrafts.findMany({
    where: and(
      inArray(socialPostDrafts.brandId, brandIds),
      eq(socialPostDrafts.status, "publishing"),
      or(
        lt(socialPostDrafts.claimedAt, new Date(Date.now() - STALE_AFTER_MINUTES * 60_000)),
        // A claim that never got written at all.
        sql`${socialPostDrafts.claimedAt} IS NULL`,
      ),
    ),
  });
}

export { STALE_AFTER_MINUTES };
