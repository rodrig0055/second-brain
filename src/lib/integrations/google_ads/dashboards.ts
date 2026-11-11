// Live Google Ads dashboards. Each dashboard runs GAQL against the live account
// via gaql() (no synced-data dependency), so figures are always current and we
// can reach data we never sync (Quality Score, PMax asset groups, impression
// share). Shaped into JSON the /t/[team]/dashboards client renders with Recharts.
import {
  gaql,
  microsToUnits,
  resolveGoogleAdsTarget,
  type GoogleAdsTarget,
} from "./client";
import type { DbConnection } from "../types";

export type DashboardType =
  | "account_health"
  | "pmax"
  | "quality_score"
  | "search_waste"
  | "budget"
  | "auction"
  | "anomaly";

export const DASHBOARDS: { id: DashboardType; label: string; blurb: string }[] = [
  { id: "account_health", label: "Account health", blurb: "Spend, ROAS, CPA, CTR, trends, campaign ranking" },
  { id: "pmax", label: "PMax breakdown", blurb: "Asset group ROAS, low assets, search categories" },
  { id: "quality_score", label: "Quality Score", blurb: "Every keyword by QS vs spend" },
  { id: "search_waste", label: "Search-term waste", blurb: "Top terms by cost vs conversions, negatives" },
  { id: "budget", label: "Budget allocation", blurb: "Current vs recommended split, projected ROAS lift" },
  { id: "auction", label: "Auction / impression share", blurb: "Impression share trends, where you're losing" },
  { id: "anomaly", label: "Weekly anomaly report", blurb: "This week vs last, moves > 15% flagged" },
];

const n = (v: unknown): number => Number(v ?? 0);

/** YYYY-MM-DD, `daysAgo` days before today (UTC). */
function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function rangeFor(days: number): { start: string; end: string } {
  return { start: isoDaysAgo(days - 1), end: isoDaysAgo(0) };
}

function roas(revenue: number, spend: number): number | null {
  return spend > 0 ? revenue / spend : null;
}
function cpa(spend: number, conversions: number): number | null {
  return conversions > 0 ? spend / conversions : null;
}
function ctr(clicks: number, impressions: number): number | null {
  return impressions > 0 ? clicks / impressions : null;
}

// ---- Result types (shared with the client component) ----

export type KpiSet = {
  spend: number;
  revenue: number;
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  clicks: number;
  conversions: number;
  impressions: number;
};

export type AccountHealth = {
  type: "account_health";
  currency: string;
  kpis: KpiSet;
  series: { date: string; spend: number; revenue: number; conversions: number }[];
  campaigns: {
    id: string;
    name: string;
    spend: number;
    revenue: number;
    roas: number | null;
    cpa: number | null;
    ctr: number | null;
    conversions: number;
  }[];
};

export type PmaxBreakdown = {
  type: "pmax";
  currency: string;
  assetGroups: {
    campaignName: string;
    name: string;
    spend: number;
    revenue: number;
    roas: number | null;
    conversions: number;
  }[];
  lowAssets: { assetGroup: string; fieldType: string; type: string }[];
  categories: { label: string; clicks: number; impressions: number; conversions: number }[];
  notes: string[];
};

export type QualityScore = {
  type: "quality_score";
  currency: string;
  keywords: {
    keyword: string;
    qs: number;
    spend: number;
    clicks: number;
    conversions: number;
  }[];
  flagged: { keyword: string; qs: number; spend: number }[];
};

export type SearchWaste = {
  type: "search_waste";
  currency: string;
  terms: {
    term: string;
    spend: number;
    conversions: number;
    clicks: number;
    revenue: number;
  }[];
  suggestedNegatives: { term: string; spend: number; clicks: number }[];
  totalSpend: number;
  totalWasted: number;
};

export type BudgetAllocation = {
  type: "budget";
  currency: string;
  campaigns: {
    name: string;
    spend: number;
    roas: number | null;
    currentShare: number;
    recommendedShare: number;
    recommendedSpend: number;
    delta: number;
  }[];
  currentRoas: number | null;
  projectedRoas: number | null;
  roasLift: number | null;
  note: string;
};

export type AuctionInsights = {
  type: "auction";
  series: {
    date: string;
    impressionShare: number | null;
    rankLostIS: number | null;
    budgetLostIS: number | null;
    topIS: number | null;
  }[];
  campaigns: {
    name: string;
    impressionShare: number | null;
    rankLostIS: number | null;
    budgetLostIS: number | null;
  }[];
  note: string;
};

export type AnomalyReport = {
  type: "anomaly";
  currency: string;
  metrics: {
    label: string;
    thisWeek: number;
    lastWeek: number;
    deltaPct: number | null;
    flagged: boolean;
    invert: boolean; // true = an increase is "bad" (spend, cpa)
    format: "money" | "number" | "percent" | "ratio";
  }[];
};

export type DashboardResult =
  | AccountHealth
  | PmaxBreakdown
  | QualityScore
  | SearchWaste
  | BudgetAllocation
  | AuctionInsights
  | AnomalyReport;

// ---- Dashboards ----

async function accountHealth(
  target: GoogleAdsTarget,
  currency: string,
  days: number,
): Promise<AccountHealth> {
  const { start, end } = rangeFor(days);
  const rows = await gaql<{
    campaign: { id: string; name: string };
    segments: { date: string };
    metrics: {
      costMicros?: string;
      conversions?: number;
      conversionsValue?: number;
      clicks?: string;
      impressions?: string;
    };
  }>(
    target,
    `SELECT campaign.id, campaign.name, segments.date,
       metrics.cost_micros, metrics.conversions, metrics.conversions_value,
       metrics.clicks, metrics.impressions
     FROM campaign
     WHERE segments.date BETWEEN '${start}' AND '${end}'`,
  );

  const byDate = new Map<string, { spend: number; revenue: number; conversions: number }>();
  const byCampaign = new Map<
    string,
    { name: string; spend: number; revenue: number; conversions: number; clicks: number; impressions: number }
  >();
  const kpis: KpiSet = {
    spend: 0, revenue: 0, roas: null, cpa: null, ctr: null,
    clicks: 0, conversions: 0, impressions: 0,
  };

  for (const r of rows) {
    const spend = microsToUnits(r.metrics.costMicros);
    const revenue = n(r.metrics.conversionsValue);
    const conversions = n(r.metrics.conversions);
    const clicks = n(r.metrics.clicks);
    const impressions = n(r.metrics.impressions);

    kpis.spend += spend;
    kpis.revenue += revenue;
    kpis.conversions += conversions;
    kpis.clicks += clicks;
    kpis.impressions += impressions;

    const d = byDate.get(r.segments.date) ?? { spend: 0, revenue: 0, conversions: 0 };
    d.spend += spend;
    d.revenue += revenue;
    d.conversions += conversions;
    byDate.set(r.segments.date, d);

    const c = byCampaign.get(r.campaign.id) ?? {
      name: r.campaign.name, spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0,
    };
    c.spend += spend;
    c.revenue += revenue;
    c.conversions += conversions;
    c.clicks += clicks;
    c.impressions += impressions;
    byCampaign.set(r.campaign.id, c);
  }

  kpis.roas = roas(kpis.revenue, kpis.spend);
  kpis.cpa = cpa(kpis.spend, kpis.conversions);
  kpis.ctr = ctr(kpis.clicks, kpis.impressions);

  const series = [...byDate.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const campaigns = [...byCampaign.entries()]
    .map(([id, c]) => ({
      id,
      name: c.name,
      spend: c.spend,
      revenue: c.revenue,
      roas: roas(c.revenue, c.spend),
      cpa: cpa(c.spend, c.conversions),
      ctr: ctr(c.clicks, c.impressions),
      conversions: c.conversions,
    }))
    .sort((a, b) => b.spend - a.spend);

  return { type: "account_health", currency, kpis, series, campaigns };
}

async function pmax(
  target: GoogleAdsTarget,
  currency: string,
  days: number,
): Promise<PmaxBreakdown> {
  const { start, end } = rangeFor(days);
  const notes: string[] = [];

  let assetGroups: PmaxBreakdown["assetGroups"] = [];
  try {
    const rows = await gaql<{
      campaign: { name: string };
      assetGroup: { id: string; name: string };
      metrics: { costMicros?: string; conversions?: number; conversionsValue?: number };
    }>(
      target,
      `SELECT campaign.name, asset_group.id, asset_group.name,
         metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM asset_group
       WHERE segments.date BETWEEN '${start}' AND '${end}'`,
    );
    const map = new Map<string, PmaxBreakdown["assetGroups"][number]>();
    for (const r of rows) {
      const key = r.assetGroup.id;
      const g = map.get(key) ?? {
        campaignName: r.campaign.name, name: r.assetGroup.name,
        spend: 0, revenue: 0, roas: null, conversions: 0,
      };
      g.spend += microsToUnits(r.metrics.costMicros);
      g.revenue += n(r.metrics.conversionsValue);
      g.conversions += n(r.metrics.conversions);
      map.set(key, g);
    }
    assetGroups = [...map.values()]
      .map((g) => ({ ...g, roas: roas(g.revenue, g.spend) }))
      .sort((a, b) => b.spend - a.spend);
    if (assetGroups.length === 0) notes.push("No Performance Max campaigns found in this account.");
  } catch (err) {
    notes.push(`Asset groups unavailable: ${msg(err)}`);
  }

  let lowAssets: PmaxBreakdown["lowAssets"] = [];
  try {
    const rows = await gaql<{
      assetGroup: { name: string };
      assetGroupAsset: { fieldType?: string; performanceLabel?: string };
      asset: { type?: string };
    }>(
      target,
      `SELECT asset_group.name, asset_group_asset.field_type,
         asset_group_asset.performance_label, asset.type
       FROM asset_group_asset
       WHERE asset_group_asset.performance_label = LOW`,
    );
    lowAssets = rows.map((r) => ({
      assetGroup: r.assetGroup.name,
      fieldType: r.assetGroupAsset.fieldType ?? "—",
      type: r.asset.type ?? "—",
    }));
  } catch {
    // Non-fatal: some accounts / API versions don't expose performance labels.
  }

  let categories: PmaxBreakdown["categories"] = [];
  try {
    const rows = await gaql<{
      campaignSearchTermInsight: { categoryLabel?: string };
      metrics: { clicks?: string; impressions?: string; conversions?: number };
    }>(
      target,
      `SELECT campaign_search_term_insight.category_label,
         metrics.clicks, metrics.impressions, metrics.conversions
       FROM campaign_search_term_insight
       WHERE segments.date BETWEEN '${start}' AND '${end}'
       ORDER BY metrics.impressions DESC
       LIMIT 25`,
    );
    const map = new Map<string, PmaxBreakdown["categories"][number]>();
    for (const r of rows) {
      const label = r.campaignSearchTermInsight.categoryLabel || "(uncategorized)";
      const c = map.get(label) ?? { label, clicks: 0, impressions: 0, conversions: 0 };
      c.clicks += n(r.metrics.clicks);
      c.impressions += n(r.metrics.impressions);
      c.conversions += n(r.metrics.conversions);
      map.set(label, c);
    }
    categories = [...map.values()].sort((a, b) => b.impressions - a.impressions);
  } catch {
    notes.push("Search category insights aren't available for this account.");
  }

  return { type: "pmax", currency, assetGroups, lowAssets, categories, notes };
}

async function qualityScore(
  target: GoogleAdsTarget,
  currency: string,
  days: number,
): Promise<QualityScore> {
  const { start, end } = rangeFor(days);
  const rows = await gaql<{
    adGroupCriterion: {
      keyword?: { text?: string };
      qualityInfo?: { qualityScore?: number };
    };
    metrics: { costMicros?: string; clicks?: string; conversions?: number };
  }>(
    target,
    `SELECT ad_group_criterion.keyword.text,
       ad_group_criterion.quality_info.quality_score,
       metrics.cost_micros, metrics.clicks, metrics.conversions
     FROM keyword_view
     WHERE segments.date BETWEEN '${start}' AND '${end}'
       AND ad_group_criterion.type = KEYWORD`,
  );

  const map = new Map<string, { keyword: string; qs: number; spend: number; clicks: number; conversions: number }>();
  for (const r of rows) {
    const keyword = r.adGroupCriterion.keyword?.text ?? "";
    if (!keyword) continue;
    const qs = n(r.adGroupCriterion.qualityInfo?.qualityScore);
    const k = map.get(keyword) ?? { keyword, qs: 0, spend: 0, clicks: 0, conversions: 0 };
    k.spend += microsToUnits(r.metrics.costMicros);
    k.clicks += n(r.metrics.clicks);
    k.conversions += n(r.metrics.conversions);
    if (qs > 0) k.qs = qs; // current QS repeats across dates; keep the known value
    map.set(keyword, k);
  }

  const keywords = [...map.values()]
    .filter((k) => k.qs > 0 || k.spend > 0)
    .sort((a, b) => b.spend - a.spend);
  const flagged = keywords
    .filter((k) => k.qs > 0 && k.qs <= 4 && k.spend > 0)
    .map((k) => ({ keyword: k.keyword, qs: k.qs, spend: k.spend }))
    .sort((a, b) => b.spend - a.spend);

  return { type: "quality_score", currency, keywords, flagged };
}

async function searchWaste(
  target: GoogleAdsTarget,
  currency: string,
  days: number,
): Promise<SearchWaste> {
  const { start, end } = rangeFor(days);
  const rows = await gaql<{
    searchTermView: { searchTerm?: string };
    metrics: { costMicros?: string; conversions?: number; clicks?: string; conversionsValue?: number };
  }>(
    target,
    `SELECT search_term_view.search_term,
       metrics.cost_micros, metrics.conversions, metrics.clicks, metrics.conversions_value
     FROM search_term_view
     WHERE segments.date BETWEEN '${start}' AND '${end}' AND metrics.cost_micros > 0`,
  );

  const map = new Map<string, SearchWaste["terms"][number]>();
  for (const r of rows) {
    const term = r.searchTermView.searchTerm ?? "";
    if (!term) continue;
    const t = map.get(term) ?? { term, spend: 0, conversions: 0, clicks: 0, revenue: 0 };
    t.spend += microsToUnits(r.metrics.costMicros);
    t.conversions += n(r.metrics.conversions);
    t.clicks += n(r.metrics.clicks);
    t.revenue += n(r.metrics.conversionsValue);
    map.set(term, t);
  }

  const all = [...map.values()].sort((a, b) => b.spend - a.spend);
  const totalSpend = all.reduce((s, t) => s + t.spend, 0);
  const suggestedNegatives = all
    .filter((t) => t.conversions === 0)
    .map((t) => ({ term: t.term, spend: t.spend, clicks: t.clicks }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 50);
  const totalWasted = suggestedNegatives.reduce((s, t) => s + t.spend, 0);

  return {
    type: "search_waste",
    currency,
    terms: all.slice(0, 50),
    suggestedNegatives,
    totalSpend,
    totalWasted,
  };
}

async function budgetAllocation(
  target: GoogleAdsTarget,
  currency: string,
  days: number,
): Promise<BudgetAllocation> {
  const { start, end } = rangeFor(days);
  const rows = await gaql<{
    campaign: { id: string; name: string };
    metrics: { costMicros?: string; conversions?: number; conversionsValue?: number };
  }>(
    target,
    `SELECT campaign.id, campaign.name,
       metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM campaign
     WHERE segments.date BETWEEN '${start}' AND '${end}'`,
  );

  const map = new Map<string, { name: string; spend: number; revenue: number }>();
  for (const r of rows) {
    const c = map.get(r.campaign.id) ?? { name: r.campaign.name, spend: 0, revenue: 0 };
    c.spend += microsToUnits(r.metrics.costMicros);
    c.revenue += n(r.metrics.conversionsValue);
    map.set(r.campaign.id, c);
  }

  const list = [...map.values()].filter((c) => c.spend > 0);
  const totalSpend = list.reduce((s, c) => s + c.spend, 0);
  const totalRevenue = list.reduce((s, c) => s + c.revenue, 0);
  // Recommend a split that leans budget toward higher-ROAS campaigns, holding
  // total spend constant. Weight = spend × ROAS; projected revenue assumes each
  // campaign's ROAS holds at the new spend (a linear first-order estimate).
  const weights = list.map((c) => c.spend * (roas(c.revenue, c.spend) ?? 0));
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  const campaigns = list
    .map((c, i) => {
      const r = roas(c.revenue, c.spend);
      const currentShare = totalSpend > 0 ? c.spend / totalSpend : 0;
      const recommendedShare = totalWeight > 0 ? weights[i] / totalWeight : currentShare;
      const recommendedSpend = recommendedShare * totalSpend;
      return {
        name: c.name,
        spend: c.spend,
        roas: r,
        currentShare,
        recommendedShare,
        recommendedSpend,
        delta: recommendedSpend - c.spend,
      };
    })
    .sort((a, b) => b.spend - a.spend);

  const projectedRevenue = campaigns.reduce(
    (s, c) => s + c.recommendedSpend * (c.roas ?? 0),
    0,
  );
  const currentRoas = roas(totalRevenue, totalSpend);
  const projectedRoas = roas(projectedRevenue, totalSpend);
  const roasLift =
    currentRoas !== null && projectedRoas !== null ? projectedRoas - currentRoas : null;

  return {
    type: "budget",
    currency,
    campaigns,
    currentRoas,
    projectedRoas,
    roasLift,
    note:
      "Recommendation leans budget toward higher-ROAS campaigns at constant total spend. " +
      "Projected ROAS assumes each campaign's return holds at its new budget — a directional estimate, not a guarantee.",
  };
}

async function auctionInsights(
  target: GoogleAdsTarget,
  days: number,
): Promise<AuctionInsights> {
  const { start, end } = rangeFor(days);
  const rows = await gaql<{
    campaign: { name: string };
    segments: { date: string };
    metrics: {
      searchImpressionShare?: number;
      searchRankLostImpressionShare?: number;
      searchBudgetLostImpressionShare?: number;
      searchTopImpressionShare?: number;
    };
  }>(
    target,
    `SELECT campaign.name, segments.date,
       metrics.search_impression_share,
       metrics.search_rank_lost_impression_share,
       metrics.search_budget_lost_impression_share,
       metrics.search_top_impression_share
     FROM campaign
     WHERE segments.date BETWEEN '${start}' AND '${end}'
       AND campaign.advertising_channel_type = SEARCH`,
  );

  // Average available shares per day / per campaign (nulls ignored).
  const dateAgg = new Map<string, Record<string, { sum: number; count: number }>>();
  const campAgg = new Map<string, Record<string, { sum: number; count: number }>>();
  const keys = ["impressionShare", "rankLostIS", "budgetLostIS", "topIS"] as const;
  const metricKey: Record<(typeof keys)[number], keyof (typeof rows)[number]["metrics"]> = {
    impressionShare: "searchImpressionShare",
    rankLostIS: "searchRankLostImpressionShare",
    budgetLostIS: "searchBudgetLostImpressionShare",
    topIS: "searchTopImpressionShare",
  };

  const add = (
    store: Map<string, Record<string, { sum: number; count: number }>>,
    id: string,
    m: (typeof rows)[number]["metrics"],
  ) => {
    const rec = store.get(id) ?? Object.fromEntries(keys.map((k) => [k, { sum: 0, count: 0 }]));
    for (const k of keys) {
      const v = m[metricKey[k]];
      if (typeof v === "number") {
        rec[k].sum += v;
        rec[k].count += 1;
      }
    }
    store.set(id, rec);
  };

  for (const r of rows) {
    add(dateAgg, r.segments.date, r.metrics);
    add(campAgg, r.campaign.name, r.metrics);
  }

  const avg = (rec: { sum: number; count: number }) => (rec.count > 0 ? rec.sum / rec.count : null);

  const series = [...dateAgg.entries()]
    .map(([date, rec]) => ({
      date,
      impressionShare: avg(rec.impressionShare),
      rankLostIS: avg(rec.rankLostIS),
      budgetLostIS: avg(rec.budgetLostIS),
      topIS: avg(rec.topIS),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const campaigns = [...campAgg.entries()]
    .map(([name, rec]) => ({
      name,
      impressionShare: avg(rec.impressionShare),
      rankLostIS: avg(rec.rankLostIS),
      budgetLostIS: avg(rec.budgetLostIS),
    }))
    .sort((a, b) => (b.impressionShare ?? 0) - (a.impressionShare ?? 0));

  return {
    type: "auction",
    series,
    campaigns,
    note:
      "Google Ads' API doesn't expose competitor domains from the Auction Insights report. " +
      "This shows your impression share and where you're losing it — to rank (ad strength / bids) vs budget.",
  };
}

async function anomalyReport(
  target: GoogleAdsTarget,
  currency: string,
): Promise<AnomalyReport> {
  const start = isoDaysAgo(13);
  const end = isoDaysAgo(0);
  const rows = await gaql<{
    segments: { date: string };
    metrics: {
      costMicros?: string;
      conversions?: number;
      conversionsValue?: number;
      clicks?: string;
      impressions?: string;
    };
  }>(
    target,
    `SELECT segments.date,
       metrics.cost_micros, metrics.conversions, metrics.conversions_value,
       metrics.clicks, metrics.impressions
     FROM customer
     WHERE segments.date BETWEEN '${start}' AND '${end}'`,
  );

  const cutoff = isoDaysAgo(6); // dates >= cutoff are "this week" (last 7 days)
  const thisW = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
  const lastW = { spend: 0, revenue: 0, conversions: 0, clicks: 0, impressions: 0 };
  for (const r of rows) {
    const bucket = r.segments.date >= cutoff ? thisW : lastW;
    bucket.spend += microsToUnits(r.metrics.costMicros);
    bucket.revenue += n(r.metrics.conversionsValue);
    bucket.conversions += n(r.metrics.conversions);
    bucket.clicks += n(r.metrics.clicks);
    bucket.impressions += n(r.metrics.impressions);
  }

  const derive = (w: typeof thisW) => ({
    ...w,
    ctr: ctr(w.clicks, w.impressions) ?? 0,
    cpa: cpa(w.spend, w.conversions) ?? 0,
    roas: roas(w.revenue, w.spend) ?? 0,
  });
  const a = derive(thisW);
  const b = derive(lastW);

  const defs: {
    label: string;
    key: keyof typeof a;
    invert: boolean;
    format: AnomalyReport["metrics"][number]["format"];
  }[] = [
    { label: "Spend", key: "spend", invert: true, format: "money" },
    { label: "Revenue", key: "revenue", invert: false, format: "money" },
    { label: "Conversions", key: "conversions", invert: false, format: "number" },
    { label: "Clicks", key: "clicks", invert: false, format: "number" },
    { label: "Impressions", key: "impressions", invert: false, format: "number" },
    { label: "CTR", key: "ctr", invert: false, format: "percent" },
    { label: "CPA", key: "cpa", invert: true, format: "money" },
    { label: "ROAS", key: "roas", invert: false, format: "ratio" },
  ];

  const metrics = defs.map((d) => {
    const thisWeek = a[d.key];
    const lastWeek = b[d.key];
    const deltaPct = lastWeek > 0 ? (thisWeek - lastWeek) / lastWeek : null;
    return {
      label: d.label,
      thisWeek,
      lastWeek,
      deltaPct,
      flagged: deltaPct !== null && Math.abs(deltaPct) > 0.15,
      invert: d.invert,
      format: d.format,
    };
  });

  return { type: "anomaly", currency, metrics };
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Resolve the connection and run one dashboard live. */
export async function runDashboard(
  conn: DbConnection,
  dashboard: DashboardType,
  days: number,
): Promise<DashboardResult> {
  const target = await resolveGoogleAdsTarget(conn);
  const currency = String(conn.config.currency ?? "USD");
  switch (dashboard) {
    case "account_health":
      return accountHealth(target, currency, days);
    case "pmax":
      return pmax(target, currency, days);
    case "quality_score":
      return qualityScore(target, currency, days);
    case "search_waste":
      return searchWaste(target, currency, days);
    case "budget":
      return budgetAllocation(target, currency, days);
    case "auction":
      return auctionInsights(target, days);
    case "anomaly":
      return anomalyReport(target, currency);
  }
}
