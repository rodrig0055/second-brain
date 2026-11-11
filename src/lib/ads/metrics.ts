/**
 * The derived-metric engine for paid media.
 *
 * Every rate here is recomputed from summed numerators and denominators, never
 * averaged from per-row rates: averaging over-weights a low-volume day, so a
 * day that spent $2 would count as much as one that spent $200. Following the
 * same discipline as the earlier unified-ads port (MIT, © 2026 Zernio).
 *
 * Deriving also makes a whole class of platform mismatch impossible: Meta
 * reports `ctr` as a percentage while Google reports it as a 0-1 fraction, and
 * a stored rate from each would be 100x apart with nothing to show for it.
 *
 * Definitions come from the performance marketing process doc (2026-07-08), not
 * from Ads Manager's defaults, because those are the numbers the team is
 * judged on:
 *   CIR        spend / conversion value, as a percentage (the headline metric)
 *   ROAS       conversion value / spend (CIR's reciprocal)
 *   LPVr       landing page views / outbound clicks
 *   warm       add to cart + initiate checkout
 *   hook rate  3-second video views / impressions
 *   hold rate  ThruPlays / 3-second views
 */

/**
 * The raw counters, all of which may be summed across rows, entities and days.
 *
 * `clicksAll` and `linkClicks` are deliberately separate names. Meta's `clicks`
 * counts every click including likes and profile taps, `inline_link_clicks`
 * counts clicks on the link, and `outbound_clicks` counts those that left Meta.
 * They differ by a lot on social placements, and the doc's CTR and LPVr targets
 * are outbound ones — so a single ambiguous `clicks` field is how a tracker
 * silently reports the wrong number.
 */
export type AdCounters = {
  spend: number;
  impressions: number;
  clicksAll: number;
  linkClicks: number;
  outboundClicks: number;
  landingPageViews: number;
  purchases: number;
  purchaseValue: number;
  addToCart: number;
  initiateCheckout: number;
  /** 3-second video plays. Zero for static creative. */
  videoViews3s: number;
  /** Plays to completion (or 15s). Zero for static creative. */
  thruPlays: number;
};

export const COUNTER_KEYS = [
  "spend",
  "impressions",
  "clicksAll",
  "linkClicks",
  "outboundClicks",
  "landingPageViews",
  "purchases",
  "purchaseValue",
  "addToCart",
  "initiateCheckout",
  "videoViews3s",
  "thruPlays",
] as const;

export const EMPTY_COUNTERS: AdCounters = Object.fromEntries(
  COUNTER_KEYS.map((k) => [k, 0]),
) as AdCounters;

/** The rates derived from a set of counters. */
export type AdRates = {
  /** Spend over revenue, as a percentage. Lower is better; over 100% loses money. */
  cir: number;
  roas: number;
  /** Outbound clicks over impressions, as a percentage — the doc's CTR. */
  ctr: number;
  /** All clicks over impressions, as a percentage. Kept for parity with Ads Manager. */
  ctrAll: number;
  cpc: number;
  cpm: number;
  /** Cost per purchase, which the sheets also call CPO. */
  cpp: number;
  aov: number;
  /** Landing page views over outbound clicks, as a percentage. */
  lpvr: number;
  costPerLpv: number;
  /** Add to cart + initiate checkout: the consideration signal for TOF and MOF. */
  warm: number;
  costPerWarm: number;
  /** 3-second views over impressions, as a percentage. Video only. */
  hookRate: number;
  /** ThruPlays over 3-second views, as a percentage. Video only. */
  holdRate: number;
};

export type AdTotals = AdCounters & AdRates;

/**
 * Division that yields 0 rather than NaN or Infinity on an empty denominator.
 *
 * A zero here means "no data", which is not the same as a real zero, so callers
 * that act on a metric must check the denominator themselves — see `hasSignal`.
 * Returning NaN instead would poison every sum downstream, and Infinity renders
 * as a plausible-looking number in a table.
 */
function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/** Sum counters across any set of rows. */
export function sumCounters(rows: Partial<AdCounters>[]): AdCounters {
  const out = { ...EMPTY_COUNTERS };
  for (const row of rows) {
    for (const key of COUNTER_KEYS) out[key] += row[key] ?? 0;
  }
  return out;
}

/** Derive every rate from one set of counters. */
export function withRates(counters: AdCounters): AdTotals {
  const warm = counters.addToCart + counters.initiateCheckout;
  return {
    ...counters,
    warm,
    cir: ratio(counters.spend, counters.purchaseValue) * 100,
    roas: ratio(counters.purchaseValue, counters.spend),
    ctr: ratio(counters.outboundClicks, counters.impressions) * 100,
    ctrAll: ratio(counters.clicksAll, counters.impressions) * 100,
    cpc: ratio(counters.spend, counters.outboundClicks),
    cpm: ratio(counters.spend, counters.impressions) * 1000,
    cpp: ratio(counters.spend, counters.purchases),
    aov: ratio(counters.purchaseValue, counters.purchases),
    lpvr: ratio(counters.landingPageViews, counters.outboundClicks) * 100,
    costPerLpv: ratio(counters.spend, counters.landingPageViews),
    costPerWarm: ratio(counters.spend, warm),
    hookRate: ratio(counters.videoViews3s, counters.impressions) * 100,
    holdRate: ratio(counters.thruPlays, counters.videoViews3s) * 100,
  };
}

/** Sum rows and derive the rates in one step. */
export function totalsOf(rows: Partial<AdCounters>[]): AdTotals {
  return withRates(sumCounters(rows));
}

/**
 * Reach, kept apart from the counters on purpose.
 *
 * Reach is people, not events, so it does not add up: the same person reached
 * on Monday and Tuesday is one person for the week, and summing the two days
 * counts them twice. Frequency inherits the error, and understates, because the
 * inflated reach sits in its denominator.
 *
 * So a multi-day or multi-entity reach has to be asked of Meta for that exact
 * window, never assembled here. `exact` records which one a value is, and
 * anything that displays reach must show that.
 */
export type ReachFigure = {
  reach: number;
  frequency: number;
  exact: boolean;
};

/** Reach for one row of one period, where the platform's figure is genuine. */
export function exactReach(reach: number, impressions: number): ReachFigure {
  return { reach, frequency: ratio(impressions, reach), exact: true };
}

/**
 * An upper bound for reach across rows, for when no window-level figure has
 * been fetched. Flagged inexact so it is never presented as a fact.
 */
export function approximateReach(
  rows: { reach: number }[],
  impressions: number,
): ReachFigure {
  const reach = rows.reduce((sum, r) => sum + (r.reach ?? 0), 0);
  return { reach, frequency: ratio(impressions, reach), exact: false };
}

/**
 * Whether a metric rests on enough data to act on.
 *
 * Bloomly PH runs about $31 a day and 1-4 orders, so a single day's CIR swings
 * between 44% and 173% on nothing but which day a purchase landed. A rule that
 * reads a rate without checking its denominator would pause a working ad on
 * that noise, so every threshold check goes through here first.
 */
export function hasSignal(
  totals: AdTotals,
  metric: keyof AdRates,
  minimums: { spend?: number; impressions?: number; purchases?: number } = {},
): boolean {
  const denominators: Record<keyof AdRates, number> = {
    cir: totals.purchaseValue,
    roas: totals.spend,
    ctr: totals.impressions,
    ctrAll: totals.impressions,
    cpc: totals.outboundClicks,
    cpm: totals.impressions,
    cpp: totals.purchases,
    aov: totals.purchases,
    lpvr: totals.outboundClicks,
    costPerLpv: totals.landingPageViews,
    warm: 1,
    costPerWarm: totals.warm,
    hookRate: totals.impressions,
    holdRate: totals.videoViews3s,
  };
  if (denominators[metric] <= 0) return false;
  if (minimums.spend !== undefined && totals.spend < minimums.spend) return false;
  if (
    minimums.impressions !== undefined &&
    totals.impressions < minimums.impressions
  ) {
    return false;
  }
  if (
    minimums.purchases !== undefined &&
    totals.purchases < minimums.purchases
  ) {
    return false;
  }
  return true;
}
