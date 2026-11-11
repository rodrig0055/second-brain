import { and, asc, between, desc, eq, inArray, like, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { brands, integrationConnections, metricsDaily, socialPostDrafts } from "@/db/schema";

/**
 * One reader for the organic social rows the Meta sync writes.
 *
 * The agent tools and the Social page both need these numbers, and they must
 * not disagree about what a row means — `metrics_daily` mixes two grains under
 * one table and tells them apart only by `dimensionKey`:
 *
 *   ""         Instagram account, a real per-day series
 *   "fbpage"   Facebook Page, a real per-day series
 *   "ig:<id>"  one Instagram post, LIFETIME counters restated every sync
 *   "fb:<id>"  one Facebook post, same
 *
 * Post rows are selected by their `ig:`/`fb:` prefix rather than by "anything
 * that is not the empty key", so adding another account-level key later cannot
 * silently start counting an account series as a post.
 *
 * See src/lib/integrations/meta_organic/sync.ts for what writes them.
 */

const POST_KEY_PATTERNS = ["ig:%", "fb:%"] as const;

function num(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function breakdown(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === "number") out[k] = n;
  }
  return out;
}

export type PostRow = {
  date: string;
  dimensionKey: string;
  impressions: number;
  clicks: number;
  extra: Record<string, unknown>;
  dimension: Record<string, string>;
};

export type SocialPost = {
  date: string;
  channel: string;
  mediaType: string;
  permalink: string;
  caption: string;
  /** null on Facebook — the metric does not exist, it is not a zero. */
  reach: number | null;
  views: number | null;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  engagement: number;
  engagementRate: string | null;
  /** Facebook only: all clicks on the post. null on Instagram. */
  clicks: number | null;
  /** Instagram feed posts only: taps through to the profile. Null on Facebook,
   *  and null on a Reel or Story, where Meta does not report it at all. */
  profileVisits: number | null;
  /** Facebook only: lifetime video views. null on Instagram, 0 on a photo. */
  videoViews: number | null;
  /** Facebook only: like/love/wow/… split. Empty when insights are missing. */
  reactions: Record<string, number> | null;
};

/**
 * Shape a stored row into what a reader should see.
 *
 * Facebook carries no reach, so `reach`, `views` and `engagementRate` come back
 * null there rather than 0 — null is what stops a real post being reported as
 * having reached nobody, and it is why the two channels are ranked separately.
 *
 * `clicks` and `profileVisits` are both stored in the `clicks` column but are
 * not the same measure, so each channel only ever exposes its own.
 */
export function asPost(r: PostRow): SocialPost {
  const e = r.extra;
  const channel = str(e.channel) || r.dimension.channel || "";
  const isFacebook = channel === "facebook";
  const hasReach = e.reachAvailable !== false;
  const reach = hasReach ? num(e.reach) : null;
  const engagement = num(e.engagement);
  // An older post can predate Page Insights retention; its zeros are unknowns.
  const hasInsights = isFacebook && e.insightsAvailable !== false;
  // Instagram only asks for `profile_visits` on feed posts — the metric does
  // not exist for a Reel or a Story, so the 0 the sync stored there means "not
  // measured", not "nobody tapped through".
  const productType = str(e.productType).toUpperCase();
  const measuresProfileVisits =
    !isFacebook && productType !== "REELS" && productType !== "STORY";

  return {
    date: r.date,
    channel,
    mediaType: str(e.mediaType) || r.dimension.mediaType || "",
    permalink: str(e.permalink) || r.dimension.permalink || "",
    caption: str(e.caption).slice(0, 300),
    reach,
    views: hasReach ? r.impressions : null,
    likes: num(e.likes),
    comments: num(e.comments),
    shares: num(e.shares),
    saves: num(e.saved),
    engagement,
    engagementRate:
      reach && reach > 0 ? ((engagement / reach) * 100).toFixed(2) + "%" : null,
    clicks: hasInsights ? num(e.clicks) : null,
    profileVisits: measuresProfileVisits ? r.clicks : null,
    videoViews: hasInsights ? num(e.videoViews) : null,
    reactions: hasInsights ? breakdown(e.reactionsByType) : null,
  };
}

/**
 * Per-post rows for a window, newest first. Excludes the account series.
 *
 * Takes a list of brands because a social manager runs several at once; a
 * single-brand call is just a list of one.
 */
export async function loadPostRows(
  brandIds: string[],
  startDate: string,
  endDate: string,
): Promise<(PostRow & { brandId: string })[]> {
  if (brandIds.length === 0) return [];
  const rows = await db
    .select()
    .from(metricsDaily)
    .where(
      and(
        inArray(metricsDaily.brandId, brandIds),
        eq(metricsDaily.platform, "meta_organic"),
        or(...POST_KEY_PATTERNS.map((p) => like(metricsDaily.dimensionKey, p))),
        between(metricsDaily.date, startDate, endDate),
      ),
    )
    .orderBy(desc(metricsDaily.date));
  return rows as unknown as (PostRow & { brandId: string })[];
}

export async function loadPosts(
  brandIds: string[],
  startDate: string,
  endDate: string,
): Promise<(SocialPost & { brandId: string })[]> {
  return (await loadPostRows(brandIds, startDate, endDate)).map((r) => ({
    ...asPost(r),
    brandId: r.brandId,
  }));
}

export type SocialPostRow = SocialPost & {
  brandId: string;
  brandName: string;
  brandSlug: string;
  /** The Meta id, without the `ig:`/`fb:` prefix. */
  externalId: string;
  dimensionKey: string;
  mediaUrl: string | null;
  /** Set when this post was published from the app, so it links back. */
  draftId: string | null;
  plannedFor: string | null;
};

export type PostsFilter = {
  brandIds: string[];
  startDate: string;
  endDate: string;
  channel?: "instagram" | "facebook";
  mediaType?: string;
  search?: string;
  limit?: number;
};

/**
 * The Posts table: every published post across the selected brands, with the
 * draft it came from where there is one.
 *
 * Posts published outside the app appear here too, because the sync writes them
 * either way — a table that only showed what we published would be a worse
 * answer to "how did last week go".
 */
export async function loadPostsTable(filter: PostsFilter): Promise<SocialPostRow[]> {
  const { brandIds, startDate, endDate, channel, mediaType, search, limit = 2000 } = filter;
  if (brandIds.length === 0) return [];

  const keyPattern =
    channel === "instagram" ? ["ig:%"] : channel === "facebook" ? ["fb:%"] : [...POST_KEY_PATTERNS];

  const rows = await db
    .select()
    .from(metricsDaily)
    .where(
      and(
        inArray(metricsDaily.brandId, brandIds),
        eq(metricsDaily.platform, "meta_organic"),
        or(...keyPattern.map((p) => like(metricsDaily.dimensionKey, p))),
        between(metricsDaily.date, startDate, endDate),
        // Caption search. `extra` is jsonb, so it needs an explicit cast
        // before a text match; searching the whole blob also matches the
        // permalink, which is close enough to what someone means by "find the
        // roses post".
        search ? sql`${metricsDaily.extra}::text ILIKE ${"%" + search + "%"}` : undefined,
      ),
    )
    .orderBy(desc(metricsDaily.date))
    .limit(limit);

  const brandRows = await db.select().from(brands).where(inArray(brands.id, brandIds));
  const brandById = new Map(brandRows.map((b) => [b.id, b]));

  const posts = (rows as unknown as (PostRow & { brandId: string })[]).map((r) => {
    const post = asPost(r);
    const brand = brandById.get(r.brandId);
    const externalId = r.dimensionKey.slice(r.dimensionKey.indexOf(":") + 1);
    const mediaUrl =
      str(r.extra.mediaUrl) || str(r.extra.thumbnailUrl) || str(r.extra.fullPicture) || null;
    return {
      ...post,
      brandId: r.brandId,
      brandName: brand?.name ?? "",
      brandSlug: brand?.slug ?? "",
      externalId,
      dimensionKey: r.dimensionKey,
      mediaUrl,
      draftId: null as string | null,
      plannedFor: null as string | null,
    } satisfies SocialPostRow;
  });

  const filtered = mediaType
    ? posts.filter((p) => p.mediaType.toLowerCase() === mediaType.toLowerCase())
    : posts;

  // Link each post back to the draft it came from, where it came from one.
  const ids = filtered.map((p) => p.externalId).filter(Boolean);
  if (ids.length) {
    const drafts = await db
      .select({
        id: socialPostDrafts.id,
        igMediaId: socialPostDrafts.igMediaId,
        fbPostId: socialPostDrafts.fbPostId,
        plannedFor: socialPostDrafts.plannedFor,
      })
      .from(socialPostDrafts)
      .where(
        and(
          inArray(socialPostDrafts.brandId, brandIds),
          or(
            inArray(socialPostDrafts.igMediaId, ids),
            inArray(socialPostDrafts.fbPostId, ids),
          ),
        ),
      );
    const byExternal = new Map<string, { id: string; plannedFor: string | null }>();
    for (const d of drafts) {
      if (d.igMediaId) byExternal.set(d.igMediaId, { id: d.id, plannedFor: d.plannedFor });
      if (d.fbPostId) byExternal.set(d.fbPostId, { id: d.id, plannedFor: d.plannedFor });
    }
    for (const post of filtered) {
      const hit = byExternal.get(post.externalId);
      if (hit) {
        post.draftId = hit.id;
        post.plannedFor = hit.plannedFor;
      }
    }
  }

  return filtered;
}

export type IgDay = {
  brandId: string;
  date: string;
  reach: number;
  /** New followers that day, not the audience size. */
  newFollowers: number;
  /** Audience size that day, once the sync has started recording it. */
  followersTotal: number | null;
};

export type FbDay = {
  brandId: string;
  date: string;
  /** Running TOTAL followers on that day — the opposite of `newFollowers`. */
  followersTotal: number;
  newFollows: number;
  postEngagements: number;
  pageViews: number;
};

async function accountRows(
  brandIds: string[],
  dimensionKey: string,
  startDate: string,
  endDate: string,
) {
  if (brandIds.length === 0) return [];
  return db
    .select()
    .from(metricsDaily)
    .where(
      and(
        inArray(metricsDaily.brandId, brandIds),
        eq(metricsDaily.platform, "meta_organic"),
        eq(metricsDaily.dimensionKey, dimensionKey),
        between(metricsDaily.date, startDate, endDate),
      ),
    )
    .orderBy(asc(metricsDaily.date));
}

export async function loadInstagramDays(
  brandIds: string[],
  startDate: string,
  endDate: string,
): Promise<IgDay[]> {
  const rows = await accountRows(brandIds, "", startDate, endDate);
  return rows.map((r) => {
    const e = r.extra as Record<string, unknown>;
    return {
      brandId: r.brandId,
      date: r.date,
      reach: num(e.reach),
      newFollowers: num(e.newFollowers),
      followersTotal: typeof e.followersTotal === "number" ? e.followersTotal : null,
    };
  });
}

export async function loadFacebookDays(
  brandIds: string[],
  startDate: string,
  endDate: string,
): Promise<FbDay[]> {
  const rows = await accountRows(brandIds, "fbpage", startDate, endDate);
  return rows.map((r) => {
    const e = r.extra as Record<string, unknown>;
    return {
      brandId: r.brandId,
      date: r.date,
      followersTotal: num(e.followersTotal),
      newFollows: num(e.newFollows),
      postEngagements: num(e.postEngagements),
      pageViews: num(e.pageViews),
    };
  });
}

/**
 * Audience sizes as of the last sync. Snapshots, not history: they live on the
 * connection because a dated row would invite summing them.
 */
export type FollowerSnapshot = {
  instagram: number | null;
  facebook: number | null;
  igUsername: string;
  pageName: string;
  connectionStatus: string;
};

export async function loadFollowerSnapshots(
  brandIds: string[],
): Promise<Map<string, FollowerSnapshot>> {
  const out = new Map<string, FollowerSnapshot>();
  if (brandIds.length === 0) return out;
  const conns = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        inArray(integrationConnections.brandId, brandIds),
        eq(integrationConnections.platform, "meta_organic"),
      ),
    );
  for (const conn of conns) {
    const ig = conn.config.followersCount;
    const fb = conn.config.pageFollowersCount;
    out.set(conn.brandId, {
      instagram: typeof ig === "number" ? ig : null,
      facebook: typeof fb === "number" ? fb : null,
      igUsername: String(conn.config.igUsername ?? ""),
      pageName: String(conn.config.pageName ?? ""),
      connectionStatus: conn.status,
    });
  }
  return out;
}

/** Single-brand form, for the agent tools. */
export async function loadFollowerSnapshot(brandId: string): Promise<{
  instagram: number | null;
  facebook: number | null;
}> {
  const map = await loadFollowerSnapshots([brandId]);
  const hit = map.get(brandId);
  return { instagram: hit?.instagram ?? null, facebook: hit?.facebook ?? null };
}
