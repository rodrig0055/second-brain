import type { SyncWindow } from "../types";

/** One report row's numbers. TikTok sends every metric as a string. */
export function parseReportRow(row: {
  dimensions: Record<string, string>;
  metrics: Record<string, string>;
}) {
  const n = (k: string) => {
    const v = Number(row.metrics[k] ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  return {
    // "2026-10-01 00:00:00", in the ad account's time zone.
    date: (row.dimensions.stat_time_day ?? "").slice(0, 10),
    spend: n("spend"),
    impressions: Math.round(n("impressions")),
    clicks: Math.round(n("clicks")),
    reach: Math.round(n("reach")),
    // The campaign's optimization event, whatever it is. Not necessarily a sale.
    conversions: Math.round(n("conversion")),
    purchases: Math.round(n("complete_payment")),
    // Despite the name, TikTok's "Purchase value (website)".
    revenue: n("total_complete_payment_rate"),
    videoViews: Math.round(n("video_play_actions")),
  };
}

/** Split a window into inclusive chunks of at most `days` days. */
export function chunkWindow(w: SyncWindow, days: number): SyncWindow[] {
  const out: SyncWindow[] = [];
  const end = Date.parse(`${w.end}T00:00:00Z`);
  let cur = Date.parse(`${w.start}T00:00:00Z`);
  while (cur <= end) {
    const stop = Math.min(cur + (days - 1) * 86_400_000, end);
    out.push({
      start: new Date(cur).toISOString().slice(0, 10),
      end: new Date(stop).toISOString().slice(0, 10),
    });
    cur = stop + 86_400_000;
  }
  return out;
}
