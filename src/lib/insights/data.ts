import "server-only";
import { and, asc, between, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, metricsDaily } from "@/db/schema";
import {
  INSIGHT_PLATFORMS,
  type InsightPlatformId,
  type MetricKey,
} from "./platforms";


// Re-export the client-safe helpers so server callers can keep importing from
// this module; the canonical home is ./format (bundles into client too).
export {
  formatMoney,
  formatCompactMoney,
  deltaPct,
} from "./format";
import {
  addDays,
  parseDateRange,
  previousWindow,
  type ResolvedDateRange,
  type SearchParamsLike,
} from "@/lib/date-range";


// ---- Date range ----
//
// The window itself lives in @/lib/date-range, which every surface shares. This
// keeps the shape Insights already passes around and always computes the
// previous window, because the WoW pills on this page are not optional.

export type DateRange = {
  days: number;
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
  prevStart: string; // previous equal-length window, for WoW deltas
  prevEnd: string;
  /** The resolved window, for the control and for building links. */
  resolved: ResolvedDateRange;
};

/**
 * Read the window out of the URL. Accepts the legacy `?range=30` links.
 *
 * Note this now anchors on Asia/Manila rather than UTC, so "today" rolls over
 * at Manila midnight like every other surface.
 */
export function parseRange(searchParams: SearchParamsLike | string | undefined): DateRange {
  const sp: SearchParamsLike =
    typeof searchParams === "string" || searchParams === undefined
      ? { range: searchParams }
      : searchParams;
  const resolved = parseDateRange(sp, { defaultDays: 30 });
  const prev = resolved.prev ?? previousWindow(resolved.start, resolved.end);
  return {
    days: resolved.days,
    start: resolved.start,
    end: resolved.end,
    prevStart: prev.start,
    prevEnd: prev.end,
    resolved,
  };
}

// ---- Aggregated shapes ----

export type MetricTotals = Record<MetricKey, number>;
export type DailyPoint = { date: string } & MetricTotals;

export type PlatformData = {
  id: InsightPlatformId;
  currency: string;
  hasData: boolean;
  series: DailyPoint[]; // current window, zero-filled
  totals: MetricTotals;
  prevTotals: MetricTotals;
  connection?: {
    status: string;
    lastSyncAt: Date | null;
  };
};

export type Blended = {
  displayCurrency: string;
  otherCurrencies: string[];
  revenue: number;
  prevRevenue: number;
  spend: number;
  prevSpend: number;
  roas: number | null;
  prevRoas: number | null;
  orders: number;
  prevOrders: number;
  conversions: number;
  prevConversions: number;
  commerceCurrency: string | null;
  aov: number | null;
  prevAov: number | null;
};

export type InsightsData = {
  range: DateRange;
  byPlatform: Map<InsightPlatformId, PlatformData>;
  blended: Blended;
  dailyBlended: { date: string; revenue: number; spend: number }[];
};

function zeroTotals(): MetricTotals {
  return {
    revenue: 0,
    spend: 0,
    orders: 0,
    conversions: 0,
    impressions: 0,
    clicks: 0,
    sessions: 0,
    emailsSent: 0,
    opens: 0,
  };
}

type Row = {
  platform: InsightPlatformId;
  date: string;
  currency: string;
  revenue: string;
  spend: string;
  orders: number;
  conversions: number;
  impressions: number;
  clicks: number;
  sessions: number;
  emailsSent: number;
  opens: number;
};

function toPoint(date: string, row?: Row): DailyPoint {
  const t = zeroTotals();
  if (row) {
    t.revenue = Number(row.revenue);
    t.spend = Number(row.spend);
    t.orders = row.orders;
    t.conversions = row.conversions;
    t.impressions = row.impressions;
    t.clicks = row.clicks;
    t.sessions = row.sessions;
    t.emailsSent = row.emailsSent;
    t.opens = row.opens;
  }
  return { date, ...t };
}

function addInto(target: MetricTotals, row: Row) {
  target.revenue += Number(row.revenue);
  target.spend += Number(row.spend);
  target.orders += row.orders;
  target.conversions += row.conversions;
  target.impressions += row.impressions;
  target.clicks += row.clicks;
  target.sessions += row.sessions;
  target.emailsSent += row.emailsSent;
  target.opens += row.opens;
}

/** Inclusive list of YYYY-MM-DD dates from start to end. */
function dateSpan(start: string, end: string): string[] {
  const out: string[] = [];
  let d = start;
  while (d <= end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/**
 * Load everything the Insights page needs for one brand + range: per-platform
 * series/totals (current + previous window) and a currency-honest blended
 * top-line. Account-level rows only (dimensionKey = "") to avoid double-counting
 * the campaign-level rows Meta/Google also write.
 */
export async function loadInsights(
  brandId: string,
  range: DateRange,
): Promise<InsightsData> {
  // One round trip spanning previous-window-start .. current-end.
  const rows = (await db
    .select({
      platform: metricsDaily.platform,
      date: metricsDaily.date,
      currency: metricsDaily.currency,
      revenue: metricsDaily.revenue,
      spend: metricsDaily.spend,
      orders: metricsDaily.orders,
      conversions: metricsDaily.conversions,
      impressions: metricsDaily.impressions,
      clicks: metricsDaily.clicks,
      sessions: metricsDaily.sessions,
      emailsSent: metricsDaily.emailsSent,
      opens: metricsDaily.opens,
    })
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.brandId, brandId),
        eq(metricsDaily.dimensionKey, ""),
        between(metricsDaily.date, range.prevStart, range.end),
      ),
    )
    .orderBy(asc(metricsDaily.date))) as Row[];

  const connections = await db.query.integrationConnections.findMany({
    where: eq(integrationConnections.brandId, brandId),
    columns: { platform: true, status: true, lastSyncAt: true },
  });
  const connByPlatform = new Map(connections.map((c) => [c.platform, c]));

  const currentDates = dateSpan(range.start, range.end);

  // Group rows per platform, splitting current vs previous window.
  const byPlatform = new Map<InsightPlatformId, PlatformData>();
  for (const spec of INSIGHT_PLATFORMS) {
    const pRows = rows.filter((r) => r.platform === spec.id);
    const curRows = pRows.filter((r) => r.date >= range.start);
    const prevRows = pRows.filter((r) => r.date < range.start);

    const totals = zeroTotals();
    curRows.forEach((r) => addInto(totals, r));
    const prevTotals = zeroTotals();
    prevRows.forEach((r) => addInto(prevTotals, r));

    const rowByDate = new Map(curRows.map((r) => [r.date, r]));
    const series = currentDates.map((d) => toPoint(d, rowByDate.get(d)));
    const conn = connByPlatform.get(spec.id);

    byPlatform.set(spec.id, {
      id: spec.id,
      // Prefer a row's currency in the window, else any row, else "".
      currency: curRows[0]?.currency ?? pRows[0]?.currency ?? "",
      hasData: curRows.length > 0,
      series,
      totals,
      prevTotals,
      connection: conn
        ? { status: conn.status, lastSyncAt: conn.lastSyncAt }
        : undefined,
    });
  }

  const blended = computeBlended(byPlatform);
  const dailyBlended = computeDailyBlended(
    byPlatform,
    currentDates,
    blended.displayCurrency,
  );

  return { range, byPlatform, blended, dailyBlended };
}

// Sum a money metric per currency across the platforms that contribute it.
function moneyByCurrency(
  byPlatform: Map<InsightPlatformId, PlatformData>,
  pick: (p: (typeof INSIGHT_PLATFORMS)[number]) => boolean,
  field: "revenue" | "spend",
  which: "totals" | "prevTotals",
): Map<string, number> {
  const m = new Map<string, number>();
  for (const spec of INSIGHT_PLATFORMS) {
    if (!pick(spec)) continue;
    const d = byPlatform.get(spec.id);
    if (!d || !d.currency) continue;
    const v = d[which][field];
    if (v === 0) continue;
    m.set(d.currency, (m.get(d.currency) ?? 0) + v);
  }
  return m;
}

function computeBlended(
  byPlatform: Map<InsightPlatformId, PlatformData>,
): Blended {
  const revByCur = moneyByCurrency(
    byPlatform,
    (p) => p.contributesRevenue,
    "revenue",
    "totals",
  );
  const spendByCur = moneyByCurrency(
    byPlatform,
    (p) => p.contributesSpend,
    "spend",
    "totals",
  );
  const prevRevByCur = moneyByCurrency(
    byPlatform,
    (p) => p.contributesRevenue,
    "revenue",
    "prevTotals",
  );
  const prevSpendByCur = moneyByCurrency(
    byPlatform,
    (p) => p.contributesSpend,
    "spend",
    "prevTotals",
  );

  // Pick a display currency: prefer one where BOTH revenue and spend exist (so
  // ROAS is meaningful), maximizing rev+spend; else the largest-revenue
  // currency; else the largest-spend currency.
  const allCurrencies = new Set<string>([
    ...revByCur.keys(),
    ...spendByCur.keys(),
  ]);
  let displayCurrency = "";
  let bestScore = -1;
  let bestHasBoth = false;
  for (const cur of allCurrencies) {
    const rev = revByCur.get(cur) ?? 0;
    const sp = spendByCur.get(cur) ?? 0;
    const hasBoth = rev > 0 && sp > 0;
    const score = rev + sp;
    if (
      (hasBoth && !bestHasBoth) ||
      (hasBoth === bestHasBoth && score > bestScore)
    ) {
      bestHasBoth = hasBoth;
      bestScore = score;
      displayCurrency = cur;
    }
  }

  const revenue = revByCur.get(displayCurrency) ?? 0;
  const spend = spendByCur.get(displayCurrency) ?? 0;
  const prevRevenue = prevRevByCur.get(displayCurrency) ?? 0;
  const prevSpend = prevSpendByCur.get(displayCurrency) ?? 0;

  const otherCurrencies = [...allCurrencies].filter(
    (c) => c && c !== displayCurrency,
  );

  // Orders + conversions are counts — currency-agnostic, sum across platforms.
  let orders = 0,
    prevOrders = 0,
    conversions = 0,
    prevConversions = 0;
  for (const spec of INSIGHT_PLATFORMS) {
    const d = byPlatform.get(spec.id);
    if (!d) continue;
    orders += d.totals.orders;
    prevOrders += d.prevTotals.orders;
    if (spec.contributesSpend) {
      conversions += d.totals.conversions;
      prevConversions += d.prevTotals.conversions;
    }
  }

  // AOV is a commerce figure: revenue ÷ orders within the commerce currency.
  let commerceCurrency: string | null = null;
  let commerceRevenue = 0,
    prevCommerceRevenue = 0,
    commerceOrders = 0,
    prevCommerceOrders = 0;
  for (const spec of INSIGHT_PLATFORMS) {
    if (spec.kind !== "commerce") continue;
    const d = byPlatform.get(spec.id);
    if (!d || !d.hasData) continue;
    commerceCurrency = d.currency || commerceCurrency;
    commerceRevenue += d.totals.revenue;
    prevCommerceRevenue += d.prevTotals.revenue;
    commerceOrders += d.totals.orders;
    prevCommerceOrders += d.prevTotals.orders;
  }

  return {
    displayCurrency,
    otherCurrencies,
    revenue,
    prevRevenue,
    spend,
    prevSpend,
    roas: spend > 0 ? revenue / spend : null,
    prevRoas: prevSpend > 0 ? prevRevenue / prevSpend : null,
    orders,
    prevOrders,
    conversions,
    prevConversions,
    commerceCurrency,
    aov: commerceOrders > 0 ? commerceRevenue / commerceOrders : null,
    prevAov:
      prevCommerceOrders > 0 ? prevCommerceRevenue / prevCommerceOrders : null,
  };
}

// Daily revenue vs spend in the display currency (zero-filled), for the chart.
function computeDailyBlended(
  byPlatform: Map<InsightPlatformId, PlatformData>,
  dates: string[],
  displayCurrency: string,
): { date: string; revenue: number; spend: number }[] {
  const out = dates.map((date) => ({ date, revenue: 0, spend: 0 }));
  const index = new Map(out.map((o) => [o.date, o]));
  for (const spec of INSIGHT_PLATFORMS) {
    const d = byPlatform.get(spec.id);
    if (!d || d.currency !== displayCurrency) continue;
    for (const pt of d.series) {
      const o = index.get(pt.date);
      if (!o) continue;
      if (spec.contributesRevenue) o.revenue += pt.revenue;
      if (spec.contributesSpend) o.spend += pt.spend;
    }
  }
  return out;
}

