import { decryptSecret } from "@/lib/crypto";
import {
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  fetchBounded,
  redactSecrets,
} from "../http";
import {
  GRAPH,
  graphGet,
  type GraphAuth,
} from "../meta/client";
import type { DbConnection } from "../types";

/**
 * Upstream prose, safe to store or show. Redacted before it is trimmed, never
 * after: slicing first can cut a token in half and leave the front of it in
 * the message. Same reasoning as the ads client, which has the same exposure.
 */
function upstream(text: string, max = 500): string {
  return redactSecrets(text).slice(0, max);
}

/**
 * The Graph version organic runs on, pinned apart from the ads client.
 *
 * The ads client moved to v26.0 because the write layer transcribes its field
 * allowlists per version. Organic gains nothing from that and has something to
 * lose: every metric name in this file was validated one at a time against
 * v25.0, and an invalid metric name does not degrade, it fails the whole
 * insights call. Publishing is live, so the version it runs on changes when
 * somebody has checked the v26 metric list against this one, not as a side
 * effect of an ads decision.
 */
const ORGANIC_API_VERSION = "v25.0";

/**
 * Organic Meta: Page posts + Instagram publishing and insights.
 *
 * Same system user token as the ads client, different assets and a different
 * set of scopes (pages_manage_posts, instagram_content_publish, …). Kept in its
 * own module because the ads client is account-shaped — every call there hangs
 * off `act_<id>` — and nothing organic does.
 */

export type MetaOrganicCreds = { accessToken: string };

export type OrganicTarget = {
  pageId: string;
  /** Instagram Business account id linked to the Page. "" when none is linked. */
  igUserId: string;
  apiVersion: string;
  accessToken: string;
};

export function resolveOrganicTarget(conn: DbConnection): OrganicTarget {
  if (!conn.encryptedCredentials) {
    throw new Error("Meta organic connection has no stored credentials.");
  }
  const creds = JSON.parse(
    decryptSecret(conn.encryptedCredentials),
  ) as MetaOrganicCreds;
  const pageId = String(conn.config.pageId ?? conn.externalAccountId ?? "");
  if (!pageId) throw new Error("Meta organic connection is missing its Page id.");
  return {
    pageId,
    igUserId: String(conn.config.igUserId ?? ""),
    apiVersion: String(conn.config.apiVersion ?? ORGANIC_API_VERSION),
    accessToken: creds.accessToken,
  };
}

type GraphError = { message?: string; code?: number; error_subcode?: number };

/** POST a Graph edge. Writes are never paginated, so this doesn't use graphGet. */
async function graphPost<T = Record<string, unknown>>(
  auth: GraphAuth,
  path: string,
  body: Record<string, string | number | undefined>,
): Promise<T> {
  const form = new URLSearchParams({ access_token: auth.accessToken });
  for (const [k, v] of Object.entries(body)) {
    if (v !== undefined) form.set(k, String(v));
  }
  const { res, text } = await fetchBounded(
    `${GRAPH}/${auth.apiVersion}/${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    },
    { timeoutMs: WRITE_TIMEOUT_MS },
  );
  let json: (T & { error?: GraphError }) | null = null;
  try {
    json = JSON.parse(text) as T & { error?: GraphError };
  } catch {
    throw new Error(`Meta ${res.status}: ${upstream(text)}`);
  }
  if (json?.error) {
    throw new Error(
      `Meta API error: ${upstream(json.error.message ?? JSON.stringify(json.error))}`,
    );
  }
  if (!res.ok) throw new Error(`Meta ${res.status}: ${upstream(text)}`);
  return json as T;
}

/** GET a single Graph node (not an edge), with no pagination. */
async function graphNode<T = Record<string, unknown>>(
  auth: GraphAuth,
  path: string,
  fields: string,
): Promise<T> {
  const search = new URLSearchParams({
    access_token: auth.accessToken,
    fields,
  });
  const { res, text } = await fetchBounded(
    `${GRAPH}/${auth.apiVersion}/${path}?${search}`,
    {},
    { timeoutMs: READ_TIMEOUT_MS },
  );
  const json = JSON.parse(text) as T & { error?: GraphError };
  if (json?.error) {
    throw new Error(
      `Meta API error: ${upstream(json.error.message ?? JSON.stringify(json.error))}`,
    );
  }
  if (!res.ok) throw new Error(`Meta ${res.status}: ${upstream(text)}`);
  return json;
}

// ---- Page tokens ----

/**
 * Exchange the system user token for this Page's own token.
 *
 * Required, not an optimisation. Under New Pages Experience every Page read and
 * write rejects a system user token with code 190 / subcode 2069032 ("se
 * necesita un token de acceso a la nueva experiencia de las páginas"), which
 * reads like an expired-token error and is not one. Instagram endpoints are the
 * opposite: they take the system user token directly and do NOT want this.
 *
 * The minted token inherits the system user token's lifetime, so for a
 * non-expiring system user token it also never expires.
 */
export async function mintPageToken(
  auth: GraphAuth,
  pageId: string,
): Promise<string> {
  const json = await graphNode<{ access_token?: string }>(
    auth,
    pageId,
    "access_token",
  );
  if (!json.access_token) {
    throw new Error(
      `Meta returned no Page token for ${pageId}. The system user needs a ` +
        `CREATE_CONTENT or MANAGE task on the Page, not just ad account access.`,
    );
  }
  return json.access_token;
}

/** Page-scoped auth, for the Page reads/writes that refuse the user token. */
export async function pageAuth(target: OrganicTarget): Promise<GraphAuth> {
  return {
    apiVersion: target.apiVersion,
    accessToken: await mintPageToken(target, target.pageId),
  };
}

// ---- Connect-time verification ----

export type OrganicAccountInfo = {
  pageId: string;
  pageName: string;
  username: string;
  fanCount: number;
  igUserId: string;
  igUsername: string;
  followersCount: number;
  /** Unix seconds, or 0 for a token that does not expire. */
  expiresAt: number;
};

/**
 * Confirm a token really reaches this Page and its Instagram account before we
 * store it. A system user token is valid the moment it is generated whether or
 * not anything was assigned to it, so "the token works" and "the token can post
 * as this brand" are different claims and only the second one matters here.
 */
export async function verifyOrganicCredentials(
  accessToken: string,
  pageId: string,
): Promise<OrganicAccountInfo> {
  const auth: GraphAuth = { apiVersion: ORGANIC_API_VERSION, accessToken };

  const page = await graphNode<{
    id?: string;
    name?: string;
    username?: string;
    fan_count?: number;
    instagram_business_account?: { id?: string; username?: string };
  }>(auth, pageId, "id,name,username,fan_count,instagram_business_account{id,username}");

  if (!page.id) throw new Error(`Meta returned no Page for id ${pageId}.`);

  // Minting the Page token here (rather than at first publish) is the real
  // proof the token can write: ad-account-only access reads the Page fine and
  // has no Page token to give.
  await mintPageToken(auth, pageId);

  const igUserId = page.instagram_business_account?.id ?? "";
  let igUsername = page.instagram_business_account?.username ?? "";
  let followersCount = 0;
  if (igUserId) {
    const ig = await graphNode<{ username?: string; followers_count?: number }>(
      auth,
      igUserId,
      "username,followers_count",
    );
    igUsername = ig.username ?? igUsername;
    followersCount = ig.followers_count ?? 0;
  }

  // A token with an expiry works today and stops in the middle of some future
  // week, so surface it at connect time instead of at 2am in a sync. This is
  // advisory: a failure to introspect must not block an otherwise good token.
  const expiresAt = await debugToken(accessToken)
    .then((d) => d.expiresAt)
    .catch(() => 0);

  return {
    pageId: page.id,
    pageName: page.name ?? pageId,
    username: page.username ?? "",
    fanCount: page.fan_count ?? 0,
    igUserId,
    igUsername,
    followersCount,
    expiresAt,
  };
}

/** `debug_token` needs the token as a query param, not a fields list. */
export async function debugToken(
  accessToken: string,
): Promise<{ expiresAt: number; scopes: string[]; type: string; isValid: boolean }> {
  const search = new URLSearchParams({
    input_token: accessToken,
    access_token: accessToken,
  });
  const { text } = await fetchBounded(
    `${GRAPH}/${ORGANIC_API_VERSION}/debug_token?${search}`,
  );
  const json = JSON.parse(text) as {
    data?: {
      expires_at?: number;
      scopes?: string[];
      type?: string;
      is_valid?: boolean;
    };
    error?: GraphError;
  };
  if (json.error) throw new Error(`Meta API error: ${upstream(json.error.message ?? "")}`);
  return {
    expiresAt: json.data?.expires_at ?? 0,
    scopes: json.data?.scopes ?? [],
    type: json.data?.type ?? "",
    isValid: json.data?.is_valid ?? false,
  };
}

// ---- Instagram reads ----

export type IgMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  thumbnail_url?: string;
  media_url?: string;
};

const IG_MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_product_type",
  "permalink",
  "timestamp",
  "like_count",
  "comments_count",
  "thumbnail_url",
  "media_url",
].join(",");

export async function fetchIgMedia(
  target: OrganicTarget,
  limit = 50,
  maxPages = 4,
): Promise<IgMedia[]> {
  if (!target.igUserId) return [];
  return graphGet<IgMedia>(
    target,
    `${target.igUserId}/media`,
    { fields: IG_MEDIA_FIELDS, limit },
    maxPages,
  );
}

/**
 * Per-post insights. The available metric names depend on the media's product
 * type — Reels have no `impressions` and only Reels report `plays` — so asking
 * for the wrong set fails the whole call rather than omitting a field. Each
 * media therefore gets the metric list its own type supports.
 */
export function igMetricsFor(media: IgMedia): string[] {
  const product = (media.media_product_type ?? "").toUpperCase();
  if (product === "REELS") {
    return ["reach", "likes", "comments", "shares", "saved", "views"];
  }
  if (product === "STORY") {
    return ["reach", "replies"];
  }
  return ["reach", "likes", "comments", "shares", "saved", "views", "profile_visits"];
}

export type IgInsightValue = { name: string; values?: { value?: number }[] };

export async function fetchIgMediaInsights(
  target: OrganicTarget,
  media: IgMedia,
): Promise<Record<string, number>> {
  try {
    const rows = await graphGet<IgInsightValue>(
      target,
      `${media.id}/insights`,
      { metric: igMetricsFor(media).join(",") },
      1,
    );
    const out: Record<string, number> = {};
    for (const r of rows) out[r.name] = r.values?.[0]?.value ?? 0;
    return out;
  } catch {
    // Insights disappear for media older than the retention window and for
    // posts made before the account became a business account. A post without
    // them is still a real post, so this degrades instead of failing the sync.
    return {};
  }
}

/**
 * Account-level DAILY series. Only two metrics still come back as a per-day
 * series on v25.0: `reach` and `follower_count`.
 *
 * `follower_count` is NEW followers on that day, not the running total — the
 * values are small integers like 1 or 3 against an audience of thousands. The
 * total lives on the account node (`fetchIgFollowersTotal`). Reading the daily
 * metric as a total is the obvious mistake here and it looks plausible in a
 * chart, so the two are deliberately separate calls.
 *
 * `profile_views`, `views`, `accounts_engaged` and `total_interactions` still
 * exist but only as `metric_type=total_value`, i.e. one aggregate for the whole
 * window with no daily breakdown. They are not fetched here for that reason.
 *
 * maxPages is 1 on purpose. On a date-bounded insights call `paging.next` is
 * not more of the same data — it is the NEXT time window, so following it
 * returns days AFTER `until`, including days that have not happened yet, as a
 * run of zeros. A whole 30-day range arrives in the first response anyway.
 *
 * `end_time` here names the day it measures, so slicing it to YYYY-MM-DD is
 * correct. The Page API does NOT do this — see `fetchPageDailyInsights`.
 */
export async function fetchIgAccountInsights(
  target: OrganicTarget,
  since: string,
  until: string,
): Promise<IgInsightValue[]> {
  if (!target.igUserId) return [];
  return graphGet<IgInsightValue>(
    target,
    `${target.igUserId}/insights`,
    { metric: "reach,follower_count", period: "day", since, until },
    1,
  );
}

/** Current total followers. A point-in-time snapshot, not a daily series. */
export async function fetchIgFollowersTotal(
  target: OrganicTarget,
): Promise<number> {
  if (!target.igUserId) return 0;
  const node = await graphNode<{ followers_count?: number }>(
    target,
    target.igUserId,
    "followers_count",
  ).catch(() => ({ followers_count: undefined }));
  return node.followers_count ?? 0;
}

/**
 * Remaining posts in the rolling 24h publish quota. Read this before publishing
 * rather than discovering the limit as a failed post.
 */
export async function fetchIgPublishQuota(
  target: OrganicTarget,
): Promise<{ used: number; total: number }> {
  if (!target.igUserId) return { used: 0, total: 0 };
  const rows = await graphGet<{
    quota_usage?: number;
    config?: { quota_total?: number };
  }>(target, `${target.igUserId}/content_publishing_limit`, {
    fields: "config,quota_usage",
  }, 1);
  return {
    used: rows[0]?.quota_usage ?? 0,
    total: rows[0]?.config?.quota_total ?? 100,
  };
}

// ---- Page reads ----

export type PagePost = {
  id: string;
  message?: string;
  created_time?: string;
  permalink_url?: string;
  full_picture?: string;
  shares?: { count?: number };
  likes?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};

/**
 * Engagement comes from summary COUNTS on the post, not from Page Insights.
 *
 * `.summary(true).limit(0)` needs only pages_read_engagement and returns the
 * real totals. Page Insights adds clicks, the reaction breakdown and video
 * views on top of this (see `fetchPagePostInsights`), but it cannot replace
 * these counts.
 *
 * Facebook posts still have NO reach figure, and no permission can change
 * that. On v25.0 post_impressions, post_impressions_unique,
 * post_impressions_organic, post_reach and post_engaged_users are gone as
 * metric NAMES — every one of them answers "(#100) The value must be a valid
 * insights metric" even with read_insights granted (re-verified 2026-09-17).
 * Downstream code must leave reach absent rather than write a 0 that reads as
 * "nobody saw it".
 */
const PAGE_POST_FIELDS = [
  "id",
  "message",
  "created_time",
  "permalink_url",
  "full_picture",
  "shares",
  "likes.summary(true).limit(0)",
  "comments.summary(true).limit(0)",
].join(",");

export async function fetchPagePosts(
  target: OrganicTarget,
  limit = 50,
  maxPages = 4,
  auth?: GraphAuth,
): Promise<PagePost[]> {
  return graphGet<PagePost>(
    auth ?? (await pageAuth(target)),
    `${target.pageId}/posts`,
    { fields: PAGE_POST_FIELDS, limit },
    maxPages,
  );
}

/** Flatten a Page post's summary counts into the shape the sync stores. */
export function pagePostEngagement(p: PagePost): {
  likes: number;
  comments: number;
  shares: number;
  engagement: number;
} {
  const likes = p.likes?.summary?.total_count ?? 0;
  const comments = p.comments?.summary?.total_count ?? 0;
  const shares = p.shares?.count ?? 0;
  return { likes, comments, shares, engagement: likes + comments + shares };
}

// ---- Page Insights ----

/**
 * Page Insights needs the `read_insights` permission. The token gained it on
 * 2026-09-17; before that every call here returned empty rows. Everything in
 * this section therefore degrades to "no data" rather than throwing, so a token
 * that loses the permission again costs the extra numbers and not the sync.
 *
 * What is NOT here, and cannot be: reach. See the note on PAGE_POST_FIELDS.
 */

/** Raw insight row. `period` matters — see `pickLifetime` below. */
type InsightRow = {
  name: string;
  period?: string;
  values?: { value?: number | Record<string, number>; end_time?: string }[];
};

/**
 * Collapse one post's insight rows into a flat map.
 *
 * Meta returns `post_video_views` TWICE: once as `period: "lifetime"` (the real
 * total) and once as `period: "day"` whose last bucket is usually 0. Keying
 * purely on `name` therefore overwrites 126 views with 0 — silently, and only
 * for video posts. Lifetime wins here because these are cumulative per-post
 * counters, which is also what every other metric in this call returns.
 */
function pickLifetime(rows: InsightRow[]): Record<string, number | Record<string, number>> {
  const out: Record<string, number | Record<string, number>> = {};
  const seenLifetime = new Set<string>();
  for (const r of rows) {
    const v = r.values?.[0]?.value;
    if (v === undefined) continue;
    if (r.period === "lifetime") {
      out[r.name] = v;
      seenLifetime.add(r.name);
    } else if (!seenLifetime.has(r.name)) {
      out[r.name] = v;
    }
  }
  return out;
}

function numOf(v: unknown): number {
  return typeof v === "number" ? v : 0;
}

function breakdownOf(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
    if (typeof n === "number") out[k] = n;
  }
  return out;
}

export type PagePostInsights = {
  /** All clicks anywhere in the post: link, photo expand, "see more", profile. */
  clicks: number;
  clicksByType: Record<string, number>;
  /** like / comment / share counts as Insights attributes them. */
  activityByType: Record<string, number>;
  /** like / love / wow / haha / sad / angry. Sums to total reactions. */
  reactionsByType: Record<string, number>;
  /** Lifetime video views. 0 on a non-video post, which is not an error. */
  videoViews: number;
};

const PAGE_POST_METRICS = [
  "post_clicks",
  "post_clicks_by_type",
  "post_activity_by_action_type",
  "post_reactions_by_type_total",
  "post_video_views",
].join(",");

/** Meta's cap on `ids=`. */
const IDS_PER_CALL = 50;

/**
 * Per-post Page Insights for many posts at once.
 *
 * `GET /insights?ids=a,b,c` returns an object keyed by post id instead of the
 * usual `{data:[…]}`, so this cannot go through `graphGet` (which reads
 * `json.data` and would hand back an empty array). Batching matters: the
 * alternative is one HTTP call per post on every sync.
 *
 * One bad metric name fails the whole call, so a failed chunk is dropped rather
 * than retried field by field — the posts in it simply come back without
 * insights, and the summary counts on the post itself still carry engagement.
 */
export async function fetchPagePostInsights(
  target: OrganicTarget,
  postIds: string[],
  auth?: GraphAuth,
): Promise<Map<string, PagePostInsights>> {
  const out = new Map<string, PagePostInsights>();
  if (postIds.length === 0) return out;
  const a = auth ?? (await pageAuth(target).catch(() => null));
  if (!a) return out;

  for (let i = 0; i < postIds.length; i += IDS_PER_CALL) {
    const chunk = postIds.slice(i, i + IDS_PER_CALL);
    const search = new URLSearchParams({
      access_token: a.accessToken,
      ids: chunk.join(","),
      metric: PAGE_POST_METRICS,
    });
    try {
      const { text } = await fetchBounded(
        `${GRAPH}/${a.apiVersion}/insights?${search}`,
      );
      const json = JSON.parse(text) as
        | Record<string, { data?: InsightRow[] }>
        | { error?: GraphError };
      if ("error" in json && json.error) continue;
      for (const [postId, body] of Object.entries(
        json as Record<string, { data?: InsightRow[] }>,
      )) {
        const m = pickLifetime(body?.data ?? []);
        out.set(postId, {
          clicks: numOf(m.post_clicks),
          clicksByType: breakdownOf(m.post_clicks_by_type),
          activityByType: breakdownOf(m.post_activity_by_action_type),
          reactionsByType: breakdownOf(m.post_reactions_by_type_total),
          videoViews: numOf(m.post_video_views),
        });
      }
    } catch {
      // Network-level failure on one chunk. Same treatment as a rejected call.
    }
  }
  return out;
}

export type PageDailyInsights = {
  date: string;
  /**
   * TOTAL followers as of that day, not the day's gain — `page_follows` is a
   * running total (10455 → 10487 over a week). This is the exact opposite of
   * Instagram's `follower_count`, which IS per-day. Getting the two the same
   * way round is the mistake to avoid; both look plausible in a chart.
   */
  followersTotal: number;
  /** Gross new follows that day. Net growth also subtracts unfollows, which
   *  Meta does not expose, so this does not reconcile exactly with the total. */
  newFollows: number;
  postEngagements: number;
  pageViews: number;
};

/**
 * Page-level daily series.
 *
 * The caller chunks the range, as it does for Instagram; a very long span is
 * refused with "Invalid parameter". The ceiling is not the 30 days Instagram
 * imposes (34 still answers), which is what makes the `until + 1` below safe.
 *
 * Two traps, both verified against the live Page on 2026-09-17:
 *
 *  - `end_time` is EXCLUSIVE here: the bucket stamped 2026-09-18 is the day
 *    2026-09-17. Instagram's identical-looking series is the other way round
 *    and stamps the day it measures. Slicing the timestamp the same way for
 *    both puts every Facebook number one day late, which no chart would show
 *    as wrong. Hence `shiftBack` — and hence asking Meta for `until + 1`,
 *    because the bucket holding day `until` is stamped the day after it and a
 *    request that stops at `until` never returns it. Without that the series
 *    silently ends a day or two short of Instagram's on every sync.
 *  - `paging.next` walks FORWARD past `until` into days that have not happened,
 *    which arrive as a run of zeros with the follower total frozen at its last
 *    real value. maxPages is 1 and the range is clamped for that reason.
 *
 * `page_impressions`, `page_impressions_unique`, `page_fans` and
 * `page_fan_adds` are NOT here: all four are invalid metric names on v25.0.
 * `page_total_actions` validates but is permanently 0 for this Page (it counts
 * CTA-button clicks), so it is left out rather than charted as a flat zero.
 */
export async function fetchPageDailyInsights(
  target: OrganicTarget,
  since: string,
  until: string,
  auth?: GraphAuth,
): Promise<PageDailyInsights[]> {
  const a = auth ?? (await pageAuth(target).catch(() => null));
  if (!a) return [];

  const rows = await graphGet<InsightRow>(
    a,
    `${target.pageId}/insights`,
    {
      metric: "page_follows,page_daily_follows,page_post_engagements,page_views_total",
      period: "day",
      since,
      until: addDays(until, 1),
    },
    1,
  ).catch(() => [] as InsightRow[]);

  const byDay = new Map<string, Record<string, number>>();
  for (const r of rows) {
    for (const v of r.values ?? []) {
      const day = shiftBack(v.end_time);
      // Meta can still hand back a boundary outside the asked-for range.
      if (!day || day < since || day > until) continue;
      const bucket = byDay.get(day) ?? {};
      bucket[r.name] = numOf(v.value);
      byDay.set(day, bucket);
    }
  }

  return [...byDay.entries()]
    .map(([date, b]) => ({
      date,
      followersTotal: b.page_follows ?? 0,
      newFollows: b.page_daily_follows ?? 0,
      postEngagements: b.page_post_engagements ?? 0,
      pageViews: b.page_views_total ?? 0,
    }))
    .sort((x, y) => x.date.localeCompare(y.date));
}

/** The day a Page bucket measures: one before its exclusive `end_time`. */
function shiftBack(endTime: string | undefined): string {
  if (!endTime) return "";
  const d = new Date(endTime);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---- Publishing ----

export type IgContainerStatus =
  | "EXPIRED"
  | "ERROR"
  | "FINISHED"
  | "IN_PROGRESS"
  | "PUBLISHED";

/**
 * Create an Instagram media container. Meta FETCHES `image_url`/`video_url`
 * from its own servers, so the URL has to be public https — a signed or
 * localhost URL fails here with a message that does not say that is the reason.
 */
export async function createIgContainer(
  target: OrganicTarget,
  params: {
    imageUrl?: string;
    videoUrl?: string;
    caption?: string;
    isCarouselItem?: boolean;
    children?: string[];
    mediaType?: "REELS" | "CAROUSEL";
  },
): Promise<string> {
  if (!target.igUserId) {
    throw new Error("This connection has no Instagram account linked to the Page.");
  }
  const json = await graphPost<{ id?: string }>(
    target,
    `${target.igUserId}/media`,
    {
      image_url: params.imageUrl,
      video_url: params.videoUrl,
      caption: params.caption,
      is_carousel_item: params.isCarouselItem ? "true" : undefined,
      children: params.children?.join(","),
      media_type: params.mediaType,
    },
  );
  if (!json.id) throw new Error("Meta returned no container id.");
  return json.id;
}

/**
 * Wait for a container to finish processing.
 *
 * Images are usually FINISHED immediately; video and Reels are transcoded and
 * take tens of seconds. Publishing an IN_PROGRESS container fails, so this
 * blocks until it is FINISHED or gives up. `timeoutMs` stays well under the
 * route's maxDuration=300 so the caller can still record a failure.
 */
export async function waitForIgContainer(
  target: OrganicTarget,
  containerId: string,
  timeoutMs = 120_000,
  intervalMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const json = await graphNode<{
      status_code?: IgContainerStatus;
      status?: string;
    }>(target, containerId, "status_code,status");
    const code = json.status_code;
    if (code === "FINISHED" || code === "PUBLISHED") return;
    if (code === "ERROR" || code === "EXPIRED") {
      throw new Error(
        `Instagram rejected the media (${code}): ${json.status ?? "no detail"}. ` +
          `The usual cause is an unreachable media URL or an unsupported format.`,
      );
    }
    if (Date.now() > deadline) {
      throw new Error(
        `Instagram was still processing the media after ${Math.round(timeoutMs / 1000)}s. ` +
          `The container stays valid for 24h, so retrying this draft may succeed.`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function publishIgContainer(
  target: OrganicTarget,
  creationId: string,
): Promise<{ id: string; permalink: string }> {
  const json = await graphPost<{ id?: string }>(
    target,
    `${target.igUserId}/media_publish`,
    { creation_id: creationId },
  );
  if (!json.id) throw new Error("Instagram returned no media id after publish.");
  const node = await graphNode<{ permalink?: string }>(
    target,
    json.id,
    "permalink",
  ).catch(() => ({ permalink: undefined }));
  return { id: json.id, permalink: node.permalink ?? "" };
}

/** Publish to the Facebook Page. Uses the Page token, not the user token. */
export async function publishPagePost(
  target: OrganicTarget,
  params: {
    message: string;
    link?: string;
    imageUrl?: string;
    altText?: string;
    /**
     * Unix seconds. Facebook holds the post and publishes it itself, between 10
     * minutes and 75 days out. This is the only scheduling anywhere in the app:
     * Instagram's API has none and we run no timer.
     */
    scheduledPublishTime?: number;
  },
): Promise<{ id: string; permalink: string; scheduled: boolean }> {
  const auth = await pageAuth(target);
  const scheduled = Boolean(params.scheduledPublishTime);
  const schedule = scheduled
    ? { published: "false", scheduled_publish_time: params.scheduledPublishTime }
    : {};

  // A photo post is a different edge from a text/link post, and posting a photo
  // to /feed with a `link` silently renders as a link preview instead.
  const json = params.imageUrl
    ? await graphPost<{ id?: string; post_id?: string }>(
        auth,
        `${target.pageId}/photos`,
        {
          url: params.imageUrl,
          caption: params.message,
          alt_text_custom: params.altText || undefined,
          ...schedule,
        },
      )
    : await graphPost<{ id?: string; post_id?: string }>(
        auth,
        `${target.pageId}/feed`,
        { message: params.message, link: params.link, ...schedule },
      );

  // /photos returns the photo id in `id` and the feed story in `post_id`; /feed
  // returns only `id`. The story id is the one that resolves to a real URL.
  const id = json.post_id ?? json.id ?? "";
  if (!id) throw new Error("Facebook returned no post id.");
  // A scheduled post has no public permalink until Meta publishes it; the
  // reconciliation pass in sync.ts fills it in then.
  const node = await graphNode<{ permalink_url?: string }>(
    auth,
    id,
    "permalink_url",
  ).catch(() => ({ permalink_url: undefined }));
  return { id, permalink: node.permalink_url ?? "", scheduled };
}

/** Container state without waiting. What makes a dead publish resumable. */
export async function fetchIgContainerStatus(
  target: OrganicTarget,
  containerId: string,
): Promise<{ code: IgContainerStatus | null; detail: string }> {
  const json = await graphNode<{ status_code?: IgContainerStatus; status?: string }>(
    target,
    containerId,
    "status_code,status",
  );
  return { code: json.status_code ?? null, detail: json.status ?? "" };
}

/**
 * Find a post we may have already published but failed to record.
 *
 * Only reached when a container reports PUBLISHED while our row has no media
 * id, which means the request died between Meta accepting the publish and us
 * writing it down. Matching on the exact caption within a recent window is the
 * only handle we have; if it misses we say so rather than posting again.
 */
export async function findRecentIgMedia(
  target: OrganicTarget,
  params: { caption: string; sinceMs: number },
): Promise<{ id: string; permalink: string } | null> {
  const media = await fetchIgMedia(target, 10, 1).catch(() => [] as IgMedia[]);
  const wanted = params.caption.trim();
  for (const m of media) {
    const at = Date.parse(m.timestamp ?? "");
    if (Number.isFinite(at) && at < params.sinceMs) continue;
    if ((m.caption ?? "").trim() === wanted) {
      return { id: m.id, permalink: m.permalink ?? "" };
    }
  }
  return null;
}

/**
 * First comment on a published post. Hashtags usually live here rather than in
 * the caption. Needs instagram_manage_comments; failing is never fatal, the
 * post is already up.
 */
export async function createIgComment(
  target: OrganicTarget,
  mediaId: string,
  message: string,
): Promise<string> {
  const json = await graphPost<{ id?: string }>(target, `${mediaId}/comments`, { message });
  return json.id ?? "";
}

/** Cancel a Meta-held scheduled post. */
export async function deletePagePost(target: OrganicTarget, postId: string): Promise<void> {
  const auth = await pageAuth(target);
  const search = new URLSearchParams({ access_token: auth.accessToken });
  const { res, text } = await fetchBounded(
    `${GRAPH}/${auth.apiVersion}/${postId}?${search}`,
    { method: "DELETE" },
    { timeoutMs: WRITE_TIMEOUT_MS },
  );
  let json: { error?: GraphError; success?: boolean } | null = null;
  try {
    json = JSON.parse(text) as { error?: GraphError; success?: boolean };
  } catch {
    throw new Error(`Meta ${res.status}: ${upstream(text, 300)}`);
  }
  if (json?.error) {
    throw new Error(`Meta API error: ${upstream(json.error.message ?? "unknown", 300)}`);
  }
  if (!res.ok) throw new Error(`Meta ${res.status}: ${upstream(text, 300)}`);
}

/** Whether Meta has published a post it was holding. */
export async function fetchPagePostStatus(
  target: OrganicTarget,
  postId: string,
): Promise<{
  isPublished: boolean;
  permalink: string;
  createdTime: string;
  scheduledPublishTime: number | null;
} | null> {
  const auth = await pageAuth(target);
  try {
    const json = await graphNode<{
      is_published?: boolean;
      permalink_url?: string;
      created_time?: string;
      scheduled_publish_time?: number;
    }>(auth, postId, "is_published,permalink_url,created_time,scheduled_publish_time");
    return {
      isPublished: json.is_published !== false,
      permalink: json.permalink_url ?? "",
      createdTime: json.created_time ?? "",
      scheduledPublishTime: json.scheduled_publish_time ?? null,
    };
  } catch {
    // A deleted post 404s here, which is an answer: it is not coming.
    return null;
  }
}
