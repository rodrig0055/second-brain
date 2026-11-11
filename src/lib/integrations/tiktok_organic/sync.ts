import { db } from "@/db";
import { integrationRecords, metricsDaily } from "@/db/schema";
import type { DbConnection, SyncResult, SyncWindow } from "../types";
import { accountAuth } from "../tiktok/account-auth";
import { fetchPostsSince, fetchProfile, postTime, type Post } from "./client";
import { profileRange, postEngagement } from "./shape";
import { reconcileTiktok } from "@/lib/social/publisher";

/**
 * ETL one TikTok account into metrics_daily under platform `tiktok_organic`.
 *
 * Same two grains as meta_organic, told apart by dimensionKey:
 *
 *  - ""          the account's real per-day series from /business/get/
 *                (video views, profile views, likes, follower movement).
 *  - "tt:<id>"   one row per POST, stamped on its publish day (UTC), holding
 *                that post's LIFETIME counters as of this sync. Restated every
 *                run for 30 days; never sum these across dates as daily values.
 *
 * Every count arrives T+24-48h (UTC). The newest day or two therefore read low
 * on every sync and are overwritten on the next, which is what restateDays in
 * the registry pays for. Readers should stop their charts two days back.
 */

async function upsertDaily(
  brandId: string,
  date: string,
  dimensionKey: string,
  dimension: Record<string, string>,
  m: { impressions: number; clicks: number; extra: Record<string, unknown> },
) {
  await db
    .insert(metricsDaily)
    .values({
      brandId,
      platform: "tiktok_organic",
      date,
      dimension,
      dimensionKey,
      impressions: m.impressions,
      clicks: m.clicks,
      extra: m.extra,
    })
    .onConflictDoUpdate({
      target: [
        metricsDaily.brandId,
        metricsDaily.platform,
        metricsDaily.date,
        metricsDaily.dimensionKey,
      ],
      set: {
        dimension,
        impressions: m.impressions,
        clicks: m.clicks,
        extra: m.extra,
        syncedAt: new Date(),
      },
    });
}

async function storeRecord(
  conn: DbConnection,
  recordType: string,
  externalId: string,
  day: string,
  data: Record<string, unknown>,
) {
  await db
    .insert(integrationRecords)
    .values({
      connectionId: conn.id,
      brandId: conn.brandId,
      platform: "tiktok_organic",
      recordType,
      externalId,
      periodStart: day,
      periodEnd: day,
      data,
    })
    .onConflictDoUpdate({
      target: [
        integrationRecords.connectionId,
        integrationRecords.recordType,
        integrationRecords.externalId,
      ],
      set: { data, syncedAt: new Date() },
    });
}

function postDay(p: Post): string {
  return new Date(postTime(p) * 1000).toISOString().slice(0, 10);
}

export async function syncTiktokOrganic(
  conn: DbConnection,
  window: SyncWindow,
): Promise<SyncResult> {
  const auth = await accountAuth(conn);
  let rowsWritten = 0;

  // ---- Account daily series + profile snapshot ----
  const range = profileRange(window);
  const profile = await fetchProfile(auth, range ?? undefined);
  for (const d of profile.metrics ?? []) {
    if (!d.date) continue;
    await upsertDaily(conn.brandId, d.date, "", {}, {
      impressions: d.video_views ?? 0,
      clicks: d.profile_views ?? 0,
      extra: {
        channel: "tiktok",
        videoViews: d.video_views ?? 0,
        reach: d.unique_video_views ?? 0,
        profileViews: d.profile_views ?? 0,
        likes: d.likes ?? 0,
        comments: d.comments ?? 0,
        shares: d.shares ?? 0,
        bioLinkClicks: d.bio_link_clicks ?? 0,
        engagedAudience: d.engaged_audience ?? 0,
        // Movement on the day, not the audience size.
        newFollowers: d.daily_new_followers ?? 0,
        lostFollowers: d.daily_lost_followers ?? 0,
        netFollowers: d.daily_total_followers ?? 0,
        // TikTok reports the total per date too, so unlike Instagram this is
        // real history rather than one reading copied across days.
        ...(typeof (d as { followers_count?: number }).followers_count === "number"
          ? { followersTotal: (d as { followers_count?: number }).followers_count }
          : {}),
      },
    });
    rowsWritten++;
  }
  const today = new Date().toISOString().slice(0, 10);
  // The snapshot keeps identity + audience breakdowns; the series is above.
  const snapshot: Record<string, unknown> = { ...profile };
  delete snapshot.metrics;
  await storeRecord(conn, "tt_profile", auth.openId, today, snapshot);

  // ---- Posts ----
  const since = Math.floor(Date.parse(`${window.start}T00:00:00Z`) / 1000);
  const posts = await fetchPostsSince(auth, since);
  for (const p of posts) {
    const day = postDay(p);
    const engagement = postEngagement(p);
    await upsertDaily(
      conn.brandId,
      day,
      `tt:${p.item_id}`,
      {
        mediaId: p.item_id,
        channel: "tiktok",
        mediaType: p.media_type ?? "",
        permalink: p.share_url ?? "",
      },
      {
        impressions: p.video_views ?? 0,
        clicks: p.profile_views ?? 0,
        extra: {
          channel: "tiktok",
          mediaType: p.media_type ?? "",
          permalink: p.share_url ?? "",
          caption: p.caption ?? "",
          // TikTok thumbnail URLs are signed and expire (x-expires). Fine for a
          // table rendered soon after a sync, not for anything archival.
          thumbnailUrl: p.thumbnail_url ?? "",
          isAd: p.is_ad ?? false,
          reach: p.reach ?? 0,
          views: p.video_views ?? 0,
          likes: p.likes ?? 0,
          comments: p.comments ?? 0,
          shares: p.shares ?? 0,
          saves: p.favorites ?? 0,
          engagement,
          durationSec: p.video_duration ?? null,
          avgWatchSec: p.average_time_watched ?? null,
          fullWatchRate: p.full_video_watched_rate ?? null,
          newFollowers: p.new_followers ?? null,
          websiteClicks: p.website_clicks ?? null,
          impressionSources: p.impression_sources ?? [],
        },
      },
    );
    rowsWritten++;
    await storeRecord(conn, "tt_post", p.item_id, day, p as unknown as Record<string, unknown>);
  }

  // Finish publish tasks a request left mid-flight. Never fails the sync:
  // the metrics above are written either way.
  await reconcileTiktok(conn.brandId).catch((err) =>
    console.error("tiktok: reconcile failed", err),
  );

  return { rowsWritten };
}
