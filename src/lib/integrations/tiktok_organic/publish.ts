import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, socialPostDrafts } from "@/db/schema";
import type { SocialDraft } from "@/lib/integrations/meta_organic/publish";
import {
  TIKTOK_DAILY_POSTS,
  tiktokOptions,
  tiktokPermalink,
  validateTiktokDraft,
  verifiedMediaPrefixes,
} from "@/lib/social/tiktok-rules";
import type { DbConnection } from "../types";
import { tiktokGet, tiktokPost } from "../tiktok/api";
import { mutationOutcomeUnknown } from "../http";
import { accountAuth } from "../tiktok/account-auth";

/**
 * Publish a draft to TikTok through the Accounts API.
 *
 * Only the publisher (src/lib/social/publisher.ts) calls this, after a named
 * person pressed Publish; the agent can only write drafts.
 *
 * TikTok publishing is a task, not a call: /business/{video,photo}/publish/
 * returns a `share_id` at once and TikTok then downloads the media, runs
 * moderation and posts. So, like an Instagram container, the task id is handed
 * to `onPublishId` (which writes it to the row) BEFORE we poll. A request that
 * dies while TikTok is still working leaves the id behind, and the next attempt
 * polls that task instead of publishing the post a second time.
 */

export type TiktokOutcome =
  | { state: "published"; publishId: string; postId: string | null; permalink: string | null }
  | { state: "inbox"; publishId: string }
  | { state: "processing"; publishId: string }
  | { state: "failed"; publishId: string | null; error: string };

type PublishStatus = {
  status?: "PROCESSING_DOWNLOAD" | "PUBLISH_COMPLETE" | "FAILED" | "SEND_TO_USER_INBOX" | string;
  post_ids?: string[];
  reason?: string;
};

/** The brand's TikTok account: the draft's own connection if it is one, else the brand's. */
export async function tiktokConnectionFor(draft: SocialDraft): Promise<DbConnection | null> {
  const conns = await db.query.integrationConnections.findMany({
    where: and(
      eq(integrationConnections.brandId, draft.brandId),
      eq(integrationConnections.platform, "tiktok_organic"),
      eq(integrationConnections.status, "connected"),
    ),
  });
  return conns.find((c) => c.id === draft.connectionId) ?? conns[0] ?? null;
}

async function postsInLastDay(brandId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(socialPostDrafts)
    .where(
      and(
        eq(socialPostDrafts.brandId, brandId),
        eq(socialPostDrafts.channel, "tiktok"),
        gte(socialPostDrafts.publishedAt, new Date(Date.now() - 24 * 60 * 60_000)),
      ),
    );
  return row?.n ?? 0;
}

async function startTask(
  conn: DbConnection,
  draft: SocialDraft,
): Promise<string> {
  const auth = await accountAuth(conn);
  const o = tiktokOptions(draft.tiktokOptions);
  if (draft.mediaType === "video") {
    const data = await tiktokPost<{ share_id?: string }>("/business/video/publish/", auth.accessToken, {
      business_id: auth.openId,
      video_url: draft.mediaUrls[0],
      post_info: {
        caption: draft.caption,
        is_brand_organic: o.isBrandOrganic,
        is_branded_content: o.isBrandedContent,
        disable_comment: o.disableComment,
        is_ai_generated: o.isAiGenerated,
        upload_to_draft: o.uploadToDraft,
      },
    });
    if (!data.share_id) throw new Error("TikTok accepted the video but returned no task id.");
    return data.share_id;
  }
  const data = await tiktokPost<{ share_id?: string }>("/business/photo/publish/", auth.accessToken, {
    business_id: auth.openId,
    photo_images: draft.mediaUrls,
    photo_cover_index: 0,
    post_info: {
      privacy_level: "PUBLIC_TO_EVERYONE",
      caption: draft.caption,
      ...(o.title ? { title: o.title } : {}),
      auto_add_music: o.autoAddMusic,
      is_brand_organic: o.isBrandOrganic,
      is_branded_content: o.isBrandedContent,
      disable_comment: o.disableComment,
      is_draft: o.uploadToDraft,
    },
  });
  if (!data.share_id) throw new Error("TikTok accepted the images but returned no task id.");
  return data.share_id;
}

/**
 * Where a publish task stands, polled for up to `waitMs`. TikTok can take a
 * few minutes on a long video; past the wait the row stays `publishing` with
 * its task id and is finished by the next sync or retry.
 */
export async function pollTiktokTask(
  conn: DbConnection,
  publishId: string,
  mediaType: string,
  waitMs = 40_000,
): Promise<TiktokOutcome> {
  const auth = await accountAuth(conn);
  const username = String(conn.config.username ?? "");
  const deadline = Date.now() + waitMs;
  for (;;) {
    const s = await tiktokGet<PublishStatus>("/business/publish/status/", auth.accessToken, {
      business_id: auth.openId,
      publish_id: publishId,
    });
    if (s.status === "PUBLISH_COMPLETE") {
      // Post ids can lag the status by up to three minutes; the sync fills
      // them in rather than holding this request open.
      const postId = s.post_ids?.[0] ?? null;
      return {
        state: "published",
        publishId,
        postId,
        permalink: postId ? tiktokPermalink(username, postId, mediaType) : null,
      };
    }
    if (s.status === "SEND_TO_USER_INBOX") return { state: "inbox", publishId };
    if (s.status === "FAILED") {
      return {
        state: "failed",
        publishId,
        error: `TikTok rejected the post: ${s.reason ?? "no reason given"}. See "Failure reasons" in TikTok's post publishing events doc.`,
      };
    }
    if (Date.now() >= deadline) return { state: "processing", publishId };
    await new Promise((r) => setTimeout(r, 4000));
  }
}

export async function publishTiktokDraft(
  draft: SocialDraft,
  onPublishId: (publishId: string) => Promise<void>,
): Promise<TiktokOutcome> {
  const conn = await tiktokConnectionFor(draft);
  if (!conn) {
    return { state: "failed", publishId: null, error: "No connected TikTok account for this brand." };
  }

  // A task already in flight: finish it, never start a second one.
  if (draft.ttPublishId) return pollTiktokTask(conn, draft.ttPublishId, draft.mediaType);

  const invalid = validateTiktokDraft(
    {
      mediaType: draft.mediaType,
      caption: draft.caption,
      mediaUrls: draft.mediaUrls,
      options: tiktokOptions(draft.tiktokOptions),
    },
    verifiedMediaPrefixes(),
  );
  if (invalid) return { state: "failed", publishId: null, error: invalid };

  if ((await postsInLastDay(draft.brandId)) >= TIKTOK_DAILY_POSTS) {
    return {
      state: "failed",
      publishId: null,
      error: `TikTok allows ${TIKTOK_DAILY_POSTS} API posts per account per day, and this brand has used them. Try again tomorrow.`,
    };
  }

  let publishId: string;
  try {
    publishId = await startTask(conn, draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      state: "failed",
      publishId: null,
      // No task id came back, so a retry would start a new task. If TikTok
      // got the request anyway, that is a second copy of the post.
      error: mutationOutcomeUnknown(err)
        ? `${message} TikTok may still have received it: check the account in the TikTok app before retrying.`
        : message,
    };
  }
  await onPublishId(publishId);
  return pollTiktokTask(conn, publishId, draft.mediaType);
}
