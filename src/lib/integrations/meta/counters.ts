/**
 * Turning a Meta insight row into the counters the metric engine works from.
 *
 * Meta reports conversions as lists of `{action_type, value}`, and the same
 * real-world event appears under several action types at once: a purchase is
 * `omni_purchase` and `offsite_conversion.fb_pixel_purchase` and `purchase` in
 * one row. Adding them up triples the number, which is the error the process
 * doc warns about in its own words: "Use Meta's unified purchase metric only
 * (no more double-counting sub-types)."
 *
 * So every lookup here picks ONE action type in priority order and stops. The
 * `omni_` family is Meta's de-duplicated total across web, app and offline, and
 * is what the trackers are built on.
 */
import type { AdCounters } from "@/lib/ads/metrics";
import { EMPTY_COUNTERS } from "@/lib/ads/metrics";
import type { ActionStat, InsightRow } from "./client";

/**
 * Action types per metric, most canonical first.
 *
 * The fallbacks matter for accounts whose pixel predates the omni metrics, and
 * for ad accounts where a conversion is only ever reported by the pixel.
 */
const ACTION_TYPES = {
  purchase: [
    "omni_purchase",
    "offsite_conversion.fb_pixel_purchase",
    "purchase",
  ],
  addToCart: [
    "omni_add_to_cart",
    "offsite_conversion.fb_pixel_add_to_cart",
    "add_to_cart",
  ],
  initiateCheckout: [
    "omni_initiated_checkout",
    "offsite_conversion.fb_pixel_initiate_checkout",
    "initiate_checkout",
  ],
  // `landing_page_view` first, not the omni variant: it is the column the
  // trackers were built from, and the two differ (this account reports both,
  // the omni one slightly higher). The omni variant is the fallback for an
  // account that reports only it.
  landingPageView: ["landing_page_view", "omni_landing_page_view"],
  videoView3s: ["video_view"],
} as const;

/**
 * The first matching action type's value, or 0.
 *
 * Deliberately not a sum: see the file comment. A row carrying both
 * `omni_purchase` and the pixel purchase describes one set of purchases twice.
 */
export function pickAction(
  stats: ActionStat[] | undefined,
  types: readonly string[],
): number {
  if (!stats?.length) return 0;
  for (const type of types) {
    const hit = stats.find((s) => s.action_type === type);
    if (hit) {
      const value = Number(hit.value);
      return Number.isFinite(value) ? value : 0;
    }
  }
  return 0;
}

/** Sum an action list outright, for fields that carry a single action type. */
function sumStats(stats: ActionStat[] | undefined): number {
  if (!stats?.length) return 0;
  return stats.reduce((total, s) => {
    const value = Number(s.value);
    return total + (Number.isFinite(value) ? value : 0);
  }, 0);
}

function num(raw: string | undefined): number {
  const value = Number(raw ?? 0);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Map one insight row onto the counters.
 *
 * Everything absent reads as 0 rather than undefined, so a row from a static ad
 * (no video fields) and a row from an account with no checkout events still sum
 * cleanly against each other.
 */
export function rowCounters(row: InsightRow): AdCounters {
  // Video plays live in their own field on current versions and inside
  // `actions` as `video_view` on older ones. Prefer the dedicated field: within
  // `actions`, `video_view` has meant different things across versions.
  // The field is `video_play_actions`; the older `video_3_sec_watched_actions`
  // no longer exists on v25.0. Rows synced before that swap carry the old key,
  // so it is still read as a fallback rather than dropped.
  const videoViews3s =
    sumStats(row.video_play_actions) ||
    sumStats(
      (row as { video_3_sec_watched_actions?: ActionStat[] })
        .video_3_sec_watched_actions,
    ) ||
    pickAction(row.actions, ACTION_TYPES.videoView3s);

  return {
    ...EMPTY_COUNTERS,
    spend: num(row.spend),
    impressions: num(row.impressions),
    clicksAll: num(row.clicks),
    linkClicks: num(row.inline_link_clicks),
    // `outbound_clicks` carries the single type `outbound_click`, so summing is
    // safe here and there is no de-duplication question.
    outboundClicks: sumStats(row.outbound_clicks),
    landingPageViews: pickAction(row.actions, ACTION_TYPES.landingPageView),
    purchases: pickAction(row.actions, ACTION_TYPES.purchase),
    purchaseValue: pickAction(row.action_values, ACTION_TYPES.purchase),
    addToCart: pickAction(row.actions, ACTION_TYPES.addToCart),
    initiateCheckout: pickAction(row.actions, ACTION_TYPES.initiateCheckout),
    videoViews3s,
    thruPlays: sumStats(row.video_thruplay_watched_actions),
  };
}

/**
 * Reach as reported for this row's own period.
 *
 * Returned apart from the counters because reach does not add up across rows.
 * See the note on ReachFigure in lib/ads/metrics.
 */
export function rowReach(row: InsightRow): number {
  return num(row.reach);
}

/** Which entity a row describes, given the level it was requested at. */
export function rowEntity(row: InsightRow): {
  level: "account" | "campaign" | "adset" | "ad";
  id: string;
  name: string;
} {
  if (row.ad_id) {
    return { level: "ad", id: row.ad_id, name: row.ad_name ?? row.ad_id };
  }
  if (row.adset_id) {
    return {
      level: "adset",
      id: row.adset_id,
      name: row.adset_name ?? row.adset_id,
    };
  }
  if (row.campaign_id) {
    return {
      level: "campaign",
      id: row.campaign_id,
      name: row.campaign_name ?? row.campaign_id,
    };
  }
  return { level: "account", id: "", name: "" };
}
