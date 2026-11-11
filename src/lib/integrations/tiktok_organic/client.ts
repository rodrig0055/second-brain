import { tiktokGet } from "../tiktok/api";
import type { AccountCredentials } from "../tiktok/tokens";

/**
 * Accounts API reads for one TikTok account: the profile with its daily
 * series, and the post list with per-post insights.
 *
 * Every field needs a scope the account holder may or may not have granted, and
 * asking for a field without its scope fails the whole call. So fields are
 * chosen from the scopes on the stored token rather than hard-coded.
 *
 * Latency, per TikTok's "Accounts Insights data latency" guide: identity fields
 * (username, caption, share_url) are real time; every count is T+24-48h, UTC.
 * Reference: brain/docs/reference/tiktok/business-api/api-reference/accounts/insights/
 */

const PROFILE_FIELDS_BY_SCOPE: Record<string, string[]> = {
  "user.info.basic": ["display_name", "profile_image"],
  "user.info.username": ["username"],
  "user.info.profile": ["profile_deep_link", "bio_description", "is_verified"],
  "user.info.stats": ["followers_count", "following_count", "total_likes", "videos_count"],
  "user.account.type": ["is_business_account"],
  // The daily `metrics` array and the audience breakdowns.
  "user.insights": [
    "video_views",
    "unique_video_views",
    "profile_views",
    "likes",
    "comments",
    "shares",
    "bio_link_clicks",
    "daily_total_followers",
    "daily_new_followers",
    "daily_lost_followers",
    "engaged_audience",
    "audience_countries",
    "audience_genders",
    "audience_ages",
  ],
};

const POST_FIELDS_BY_SCOPE: Record<string, string[]> = {
  "video.list": [
    "item_id",
    "media_type",
    "is_ad",
    "thumbnail_url",
    "share_url",
    "caption",
    "create_time",
    "video_duration",
    "likes",
    "comments",
    "shares",
    "favorites",
    "reach",
    "video_views",
    "total_time_watched",
    "average_time_watched",
    "full_video_watched_rate",
  ],
  "video.insights": [
    "new_followers",
    "profile_views",
    "website_clicks",
    "impression_sources",
    "audience_types",
  ],
};

export function fieldsForScopes(
  scope: string,
  table: Record<string, string[]>,
): string[] {
  const granted = new Set(scope.split(/[,\s]+/).filter(Boolean));
  const out: string[] = [];
  for (const [s, fields] of Object.entries(table)) {
    if (granted.has(s)) out.push(...fields);
  }
  return [...new Set(out)];
}

export type ProfileDay = {
  date: string;
  video_views?: number;
  unique_video_views?: number;
  profile_views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  bio_link_clicks?: number;
  daily_total_followers?: number;
  daily_new_followers?: number;
  daily_lost_followers?: number;
  engaged_audience?: number;
};

export type Share = Record<string, string | number>;

export type Profile = {
  username?: string;
  display_name?: string;
  profile_image?: string;
  profile_deep_link?: string;
  bio_description?: string;
  is_verified?: boolean;
  is_business_account?: boolean;
  followers_count?: number;
  following_count?: number;
  total_likes?: number;
  videos_count?: number;
  metrics?: ProfileDay[];
  audience_countries?: Share[];
  audience_genders?: Share[];
  audience_ages?: Share[];
};

export type Post = {
  item_id: string;
  media_type?: "VIDEO" | "PHOTO";
  is_ad?: boolean;
  thumbnail_url?: string;
  share_url?: string;
  caption?: string;
  /** Unix seconds, as a string or number depending on the day. */
  create_time?: string | number;
  video_duration?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  favorites?: number;
  reach?: number;
  video_views?: number;
  total_time_watched?: number;
  average_time_watched?: number;
  full_video_watched_rate?: number;
  new_followers?: number;
  profile_views?: number;
  website_clicks?: number;
  impression_sources?: { impression_source: string; percentage: number }[];
  audience_types?: { type: string; percentage: number }[];
};


export async function fetchProfile(
  auth: AccountCredentials,
  range?: { start: string; end: string },
): Promise<Profile> {
  const fields = fieldsForScopes(auth.scope, PROFILE_FIELDS_BY_SCOPE);
  return tiktokGet<Profile>("/business/get/", auth.accessToken, {
    business_id: auth.openId,
    fields,
    ...(range ? { start_date: range.start, end_date: range.end } : {}),
  });
}

/** Epoch seconds a post was published, from either encoding TikTok uses. */
export function postTime(p: Pick<Post, "create_time">): number {
  const n = Number(p.create_time ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Posts newest first, back to `sinceEpochSec`. The list endpoint has no date
 * filter, so it is paged until a page reaches older posts. 20 per page is
 * TikTok's ceiling and a page can arrive short even with more to come, so
 * `has_more` decides, not the page size.
 */
export async function fetchPostsSince(
  auth: AccountCredentials,
  sinceEpochSec: number,
  maxPages = 15,
): Promise<Post[]> {
  const fields = fieldsForScopes(auth.scope, POST_FIELDS_BY_SCOPE);
  if (!fields.includes("item_id")) fields.unshift("item_id");
  const out: Post[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const data = await tiktokGet<{ videos?: Post[]; cursor?: number; has_more?: boolean }>(
      "/business/video/list/",
      auth.accessToken,
      { business_id: auth.openId, fields, max_count: 20, cursor },
    );
    const videos = data.videos ?? [];
    out.push(...videos);
    const oldest = videos.length ? Math.min(...videos.map(postTime)) : 0;
    if (!data.has_more || !data.cursor || (oldest && oldest < sinceEpochSec)) break;
    cursor = data.cursor;
  }
  return out.filter((p) => postTime(p) >= sinceEpochSec);
}
