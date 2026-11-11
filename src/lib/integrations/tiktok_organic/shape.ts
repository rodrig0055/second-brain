import type { SyncWindow } from "../types";

/** TikTok refuses a profile range starting further back than this. */
export const PROFILE_MAX_LOOKBACK_DAYS = 60;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The profile-metrics range for a sync window, or null when nothing in it can
 * have data yet.
 *
 * Clamped on both ends: TikTok rejects a start more than 60 days back, and its
 * own default end is yesterday (UTC) because today has nothing. Days inside the
 * 24-48h latency still come back, low; the next sync restates them.
 */
export function profileRange(
  w: SyncWindow,
  now = new Date(),
): { start: string; end: string } | null {
  const earliest = new Date(now);
  earliest.setUTCDate(earliest.getUTCDate() - (PROFILE_MAX_LOOKBACK_DAYS - 1));
  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const start = w.start > ymd(earliest) ? w.start : ymd(earliest);
  const end = w.end < ymd(yesterday) ? w.end : ymd(yesterday);
  return start <= end ? { start, end } : null;
}

/**
 * Engagement as a marketer means it on TikTok: likes + comments + shares +
 * saves. Computed once here so the tools and any page agree on the number.
 */
export function postEngagement(p: {
  likes?: number;
  comments?: number;
  shares?: number;
  favorites?: number;
}): number {
  return (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.favorites ?? 0);
}

/** The last day whose counts are settled: TikTok lags up to 48h (UTC). */
export function lastSettledDay(now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 2);
  return ymd(d);
}
