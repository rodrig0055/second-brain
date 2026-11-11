import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationConnections,
  integrationRecords,
  metricsDaily,
} from "@/db/schema";
import type { DbConnection, SyncResult, SyncWindow } from "../types";
import {
  fetchIgAccountInsights,
  fetchIgFollowersTotal,
  fetchIgMedia,
  fetchIgMediaInsights,
  fetchPageDailyInsights,
  fetchPagePostInsights,
  fetchPagePosts,
  pageAuth,
  pagePostEngagement,
  resolveOrganicTarget,
  type IgMedia,
  type PagePost,
  type PagePostInsights,
} from "./client";
import type { GraphAuth } from "../meta/client";
import { reconcileScheduled } from "@/lib/social/publisher";

/**
 * ETL organic Page + Instagram performance into metrics_daily.
 *
 * Two different grains live in this table and they do not mean the same thing:
 *
 *  - dimensionKey ""              a real per-day series from Instagram's
 *                                 account insights (reach, new followers on
 *                                 that day).
 *  - dimensionKey "fbpage"        the same idea for the Facebook Page: a real
 *                                 per-day series from Page Insights.
 *  - dimensionKey ig:<id>/fb:<id> one row per POST, stamped on the day it was
 *                                 published, holding that post's LIFETIME
 *                                 counters as of the last sync. Likes keep
 *                                 accruing after publish, so these are
 *                                 restated on every run and must never be
 *                                 summed across dates as if they were daily.
 *
 * The tools in tools.ts read them accordingly, keyed on the `ig:`/`fb:`
 * prefixes rather than on "not the empty key" — the comment exists because the
 * column names (`impressions`, `clicks`) invite the wrong reading, and because
 * a new account-level key must never start being counted as a post.
 */

function inWindow(iso: string | undefined, w: SyncWindow): boolean {
  if (!iso) return false;
  const d = iso.slice(0, 10);
  return d >= w.start && d <= w.end;
}

function dayOf(iso: string | undefined): string {
  return (iso ?? "").slice(0, 10);
}

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
      platform: "meta_organic",
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
      platform: "meta_organic",
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

export async function syncMetaOrganic(
  conn: DbConnection,
  window: SyncWindow,
): Promise<SyncResult> {
  const target = resolveOrganicTarget(conn);
  let rowsWritten = 0;

  // ---- Instagram posts ----
  if (target.igUserId) {
    const media = await fetchIgMedia(target, 50, 6);
    const recent = media.filter((m) => inWindow(m.timestamp, window));

    for (const m of recent) {
      const ins = await fetchIgMediaInsights(target, m);
      const day = dayOf(m.timestamp);
      const extra = {
        channel: "instagram",
        mediaType: m.media_type ?? "",
        productType: m.media_product_type ?? "",
        permalink: m.permalink ?? "",
        caption: m.caption ?? "",
        // The picture itself, so a reader does not have to go to Instagram to
        // see which post a row is.
        mediaUrl: m.media_url ?? m.thumbnail_url ?? "",
        thumbnailUrl: m.thumbnail_url ?? "",
        reach: ins.reach ?? 0,
        likes: ins.likes ?? m.like_count ?? 0,
        comments: ins.comments ?? m.comments_count ?? 0,
        shares: ins.shares ?? 0,
        saved: ins.saved ?? 0,
        // Engagement is not a metric Meta returns; it is the sum a marketer
        // means by the word, computed here so every reader agrees on it.
        engagement:
          (ins.likes ?? m.like_count ?? 0) +
          (ins.comments ?? m.comments_count ?? 0) +
          (ins.shares ?? 0) +
          (ins.saved ?? 0),
      };
      await upsertDaily(
        conn.brandId,
        day,
        `ig:${m.id}`,
        {
          mediaId: m.id,
          channel: "instagram",
          mediaType: m.media_type ?? "",
          permalink: m.permalink ?? "",
        },
        {
          impressions: ins.views ?? ins.reach ?? 0,
          clicks: ins.profile_visits ?? 0,
          extra,
        },
      );
      rowsWritten++;
      await storeRecord(conn, "ig_media", m.id, day, {
        ...(m as unknown as Record<string, unknown>),
        insights: ins,
      });
    }

    // ---- Instagram account daily series ----
    // This is the only genuinely per-day data here. Meta caps the range at 30
    // days per call, so a longer window is walked in chunks.
    // Read once, before the series, so today's row can carry the audience size.
    // Instagram's daily metric is NEW followers, so without this there is no
    // way to chart the audience the way the Facebook series already allows.
    const igFollowersNow = await fetchIgFollowersTotal(target).catch(() => 0);
    const todayManila = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    for (const chunk of monthChunks(window)) {
      const rows = await fetchIgAccountInsights(target, chunk.start, chunk.end).catch(
        () => [],
      );
      const byDay = new Map<string, Record<string, number>>();
      for (const metric of rows) {
        for (const v of (metric as unknown as {
          values?: { value?: number; end_time?: string }[];
        }).values ?? []) {
          const day = dayOf(v.end_time);
          if (!day) continue;
          const bucket = byDay.get(day) ?? {};
          bucket[metric.name] = v.value ?? 0;
          byDay.set(day, bucket);
        }
      }
      for (const [day, b] of byDay) {
        await upsertDaily(
          conn.brandId,
          day,
          "",
          {},
          {
            impressions: b.reach ?? 0,
            clicks: 0,
            extra: {
              channel: "instagram",
              reach: b.reach ?? 0,
              // NEW followers on this day, not the running total. Summing these
              // gives growth over a period; it is not an audience size.
              newFollowers: b.follower_count ?? 0,
              // The audience size, only on the day we actually read it. Every
              // other day stays absent rather than carrying a number copied
              // from today, which would draw a flat line that is not history.
              ...(day === todayManila && igFollowersNow > 0
                ? { followersTotal: igFollowersNow }
                : {}),
            },
          },
        );
        rowsWritten++;
      }
    }
  }

  // ---- Facebook Page ----
  // One Page token for every Page call below. Minting is a network round trip,
  // and the posts read, the per-post insights and each daily chunk would
  // otherwise each mint their own.
  const fbAuth: GraphAuth | null = await pageAuth(target).catch(() => null);

  // Engagement arrives on the post itself (summary counts). Insights add the
  // things summaries cannot give — clicks, the reaction breakdown, video views
  // — and come back for the whole batch in one call, not one call per post.
  const posts = fbAuth
    ? await fetchPagePosts(target, 50, 4, fbAuth).catch(() => [] as PagePost[])
    : [];
  const recentPosts = posts.filter((x) => inWindow(x.created_time, window));
  const postInsights: Map<string, PagePostInsights> = fbAuth
    ? await fetchPagePostInsights(
        target,
        recentPosts.map((x) => x.id),
        fbAuth,
      )
    : new Map();

  for (const p of recentPosts) {
    const e = pagePostEngagement(p);
    const ins = postInsights.get(p.id);
    const day = dayOf(p.created_time);
    const extra = {
      channel: "facebook",
      permalink: p.permalink_url ?? "",
      caption: p.message ?? "",
      likes: e.likes,
      comments: e.comments,
      shares: e.shares,
      engagement: e.engagement,
      // Deliberately absent, not zero: reach does not exist on v25.0 for a
      // Page post at all (the metric names were removed, it is not a
      // permission). A 0 here would read as "nobody saw it", which is a
      // different claim. Everything else below IS now available.
      fullPicture: p.full_picture ?? "",
      reachAvailable: false,
      // False when Page Insights gave nothing for this post — a post older
      // than the retention window, or a token that lost `read_insights`. The
      // zeros underneath would otherwise read as real zeros.
      insightsAvailable: Boolean(ins),
      clicks: ins?.clicks ?? 0,
      clicksByType: ins?.clicksByType ?? {},
      reactionsByType: ins?.reactionsByType ?? {},
      activityByType: ins?.activityByType ?? {},
      videoViews: ins?.videoViews ?? 0,
    };
    await upsertDaily(
      conn.brandId,
      day,
      `fb:${p.id}`,
      { postId: p.id, channel: "facebook", permalink: p.permalink_url ?? "" },
      { impressions: 0, clicks: ins?.clicks ?? 0, extra },
    );
    rowsWritten++;
    await storeRecord(conn, "fb_post", p.id, day, {
      ...(p as unknown as Record<string, unknown>),
      engagement: e,
      insights: ins ?? null,
    });
  }

  // ---- Facebook Page daily series ----
  // The Page's equivalent of the Instagram account series above, and subject to
  // the same 30-day-per-call limit.
  let pageFollowers = 0;
  if (fbAuth) {
    for (const chunk of monthChunks(window)) {
      const days = await fetchPageDailyInsights(
        target,
        chunk.start,
        chunk.end,
        fbAuth,
      );
      for (const d of days) {
        if (d.followersTotal > 0) pageFollowers = d.followersTotal;
        await upsertDaily(
          conn.brandId,
          d.date,
          "fbpage",
          { channel: "facebook" },
          {
            impressions: 0,
            clicks: 0,
            extra: {
              channel: "facebook",
              // Running total on that day, NOT the day's gain. The Instagram
              // row above stores the opposite (new followers), so the two
              // account series deliberately use different key names.
              followersTotal: d.followersTotal,
              newFollows: d.newFollows,
              postEngagements: d.postEngagements,
              pageViews: d.pageViews,
            },
          },
        );
        rowsWritten++;
      }
    }
  }

  // ---- What Meta did with the posts it was holding ----
  // Facebook schedules natively and we run no timer, so this is the only thing
  // that notices a scheduled post going out — or silently not going out, which
  // is worse and needs saying.
  try {
    await reconcileScheduled(conn.brandId);
  } catch {
    // Never take a sync down over bookkeeping; the numbers above matter more.
  }

  // Current audience size is a snapshot, so it belongs on the connection rather
  // than stamped onto a dated row where it would look like history. Both
  // numbers go in one write: two updates would race on the same `config` blob
  // and the second would drop the first one's key.
  const igFollowers = target.igUserId
    ? await fetchIgFollowersTotal(target).catch(() => 0)
    : 0;
  if (igFollowers > 0 || pageFollowers > 0) {
    await db
      .update(integrationConnections)
      .set({
        config: {
          ...conn.config,
          ...(igFollowers > 0 ? { followersCount: igFollowers } : {}),
          ...(pageFollowers > 0 ? { pageFollowersCount: pageFollowers } : {}),
        },
        updatedAt: new Date(),
      })
      .where(eq(integrationConnections.id, conn.id));
  }

  return { rowsWritten };
}

/** Split a window into <=30-day chunks (Instagram's insights range limit). */
function monthChunks(w: SyncWindow): SyncWindow[] {
  const out: SyncWindow[] = [];
  const end = new Date(`${w.end}T00:00:00Z`);
  let cursor = new Date(`${w.start}T00:00:00Z`);
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 29);
    out.push({
      start: cursor.toISOString().slice(0, 10),
      end: (chunkEnd < end ? chunkEnd : end).toISOString().slice(0, 10),
    });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export type { IgMedia };
