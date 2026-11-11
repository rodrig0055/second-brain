import { and, between, eq } from "drizzle-orm";
import { db } from "@/db";
import { adCreatives, integrationRecords } from "@/db/schema";
import type { DbConnection } from "../types";
import { extractConversions, type InsightRow } from "./client";
import type {
  AdRow,
  CreativeDashboardResult,
  CreativeDashboardType,
  EvalMetric,
  IterationResult,
  KillScaleResult,
  Segment,
  WinRateResult,
} from "./creative-dashboard-types";

/**
 * Creative-analytics dashboards for Meta. Unlike the Google Ads dashboards
 * (which query the live account), these read our synced data: AI-classified
 * creatives (ad_creatives) joined to aggregated ad-level metrics
 * (integration_records "ad_insight") on ad id. Win/loss is judged against a
 * user-chosen metric + threshold.
 *
 * Constants + types live in the db-free creative-dashboard-types module so
 * client components can import them without pulling the database into the
 * browser bundle. Re-exported here for server-side callers.
 */

export {
  CREATIVE_DASHBOARDS,
  EVAL_METRICS,
} from "./creative-dashboard-types";
export type {
  AdRow,
  CreativeDashboardResult,
  CreativeDashboardType,
  EvalMetric,
  IterationResult,
  KillScaleResult,
  Segment,
  WinRateResult,
} from "./creative-dashboard-types";

// ---- metric helpers ----

function metricValueOf(metric: EvalMetric, r: {
  roas: number;
  cpa: number | null;
  ctr: number;
  conversions: number;
}): number | null {
  switch (metric) {
    case "roas":
      return r.roas;
    case "cpa":
      return r.cpa;
    case "ctr":
      return r.ctr;
    case "purchases":
      return r.conversions;
  }
}

// Higher-is-better for every metric except CPA.
function isWinnerOf(
  metric: EvalMetric,
  value: number | null,
  threshold: number,
): boolean {
  if (value === null) return false;
  return metric === "cpa" ? value <= threshold : value >= threshold;
}

// ---- data loading ----

/** Aggregate ad-level metrics per ad id from synced ad_insight rows. */
async function loadAdStats(brandId: string, startDate: string, endDate: string) {
  const records = await db
    .select({ data: integrationRecords.data })
    .from(integrationRecords)
    .where(
      and(
        eq(integrationRecords.brandId, brandId),
        eq(integrationRecords.platform, "meta"),
        eq(integrationRecords.recordType, "ad_insight"),
        between(integrationRecords.periodStart, startDate, endDate),
      ),
    );

  type Stat = {
    spend: number;
    impressions: number;
    clicks: number;
    conversions: number;
    revenue: number;
  };
  const byAd = new Map<string, Stat>();
  for (const rec of records) {
    const row = rec.data as unknown as InsightRow;
    const adId = row.ad_id;
    if (!adId) continue;
    const { conversions, conversionValue } = extractConversions(row);
    const s =
      byAd.get(adId) ??
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
    s.spend += Number(row.spend ?? 0);
    s.impressions += Number(row.impressions ?? 0);
    s.clicks += Number(row.inline_link_clicks ?? row.clicks ?? 0);
    s.conversions += conversions;
    s.revenue += conversionValue;
    byAd.set(adId, s);
  }
  return byAd;
}

/** Join classified creatives with their metrics and compute derived numbers. */
async function loadAdRows(
  conn: DbConnection,
  metric: EvalMetric,
  threshold: number,
  startDate: string,
  endDate: string,
): Promise<AdRow[]> {
  const [stats, creatives] = await Promise.all([
    loadAdStats(conn.brandId, startDate, endDate),
    db
      .select()
      .from(adCreatives)
      .where(eq(adCreatives.connectionId, conn.id)),
  ]);

  const rows: AdRow[] = [];
  for (const c of creatives) {
    const s = stats.get(c.adId);
    if (!s) continue; // no spend in this window
    const roas = s.spend > 0 ? s.revenue / s.spend : 0;
    const cpa = s.conversions > 0 ? s.spend / s.conversions : null;
    const ctr = s.impressions > 0 ? (s.clicks / s.impressions) * 100 : 0;
    const metricValue = metricValueOf(metric, { roas, cpa, ctr, conversions: s.conversions });
    rows.push({
      adId: c.adId,
      adName: c.adName,
      campaignName: c.campaignName,
      mediaType: c.mediaType,
      thumbnailUrl: c.thumbnailUrl,
      assetType: c.aiAssetType,
      messagingAngle: c.messagingAngle,
      hookTactic: c.hookTactic,
      funnelStage: c.funnelStage,
      spend: s.spend,
      impressions: s.impressions,
      clicks: s.clicks,
      conversions: s.conversions,
      revenue: s.revenue,
      roas,
      cpa,
      ctr,
      metricValue,
      isWinner: isWinnerOf(metric, metricValue, threshold),
    });
  }
  return rows;
}

function currencyOf(conn: DbConnection): string {
  return String(conn.config?.currency ?? "USD");
}

// ---- dashboards ----

const DIMENSIONS: { key: keyof AdRow; label: string }[] = [
  { key: "assetType", label: "Asset type" },
  { key: "messagingAngle", label: "Messaging angle" },
  { key: "hookTactic", label: "Hook tactic" },
  { key: "funnelStage", label: "Funnel stage" },
];

export function buildWinRate(
  rows: AdRow[],
  metric: EvalMetric,
  threshold: number,
  currency: string,
): WinRateResult {
  const dimensions = DIMENSIONS.map(({ key, label }) => {
    const groups = new Map<string, AdRow[]>();
    for (const r of rows) {
      const v = (r[key] as string | null) ?? "unclassified";
      const arr = groups.get(v) ?? [];
      arr.push(r);
      groups.set(v, arr);
    }
    const segments: Segment[] = [...groups.entries()]
      .map(([k, ads]) => {
        const winners = ads.filter((a) => a.isWinner).length;
        const metricVals = ads
          .map((a) => a.metricValue)
          .filter((v): v is number => v !== null);
        const avgMetric =
          metricVals.length > 0
            ? metricVals.reduce((a, b) => a + b, 0) / metricVals.length
            : null;
        return {
          key: k,
          ads: ads.length,
          winners,
          winRate: ads.length > 0 ? winners / ads.length : 0,
          avgMetric,
          spend: ads.reduce((a, b) => a + b.spend, 0),
        };
      })
      .sort((a, b) => b.spend - a.spend);
    return { dimension: String(key), label, segments };
  });

  return {
    type: "win_rate",
    currency,
    metric,
    threshold,
    totalAds: rows.length,
    dimensions,
  };
}

const STAGES = ["TOF", "MOF", "BOF"] as const;

export function buildKillScale(
  rows: AdRow[],
  metric: EvalMetric,
  threshold: number,
  currency: string,
  minSpend: number,
): KillScaleResult {
  const spent = rows.filter((r) => r.spend > minSpend);
  const stages = [...STAGES, "unclassified"].map((stage) => {
    const inStage = spent.filter(
      (r) => (r.funnelStage ?? "unclassified") === stage,
    );
    const bySpend = (a: AdRow, b: AdRow) => b.spend - a.spend;
    return {
      stage,
      kill: inStage.filter((r) => !r.isWinner).sort(bySpend),
      scale: inStage.filter((r) => r.isWinner).sort(bySpend),
    };
  });
  // Drop the empty "unclassified" bucket when nothing landed there.
  return {
    type: "kill_scale",
    currency,
    metric,
    threshold,
    stages: stages.filter((s) => s.kill.length > 0 || s.scale.length > 0),
  };
}

export function buildIteration(
  rows: AdRow[],
  metric: EvalMetric,
  threshold: number,
  currency: string,
  minSpend: number,
): IterationResult {
  const underperformers = rows
    .filter((r) => r.spend > minSpend && !r.isWinner)
    .sort((a, b) => b.spend - a.spend);
  return { type: "iteration", currency, metric, threshold, underperformers };
}

export async function runMetaCreativeDashboard(
  conn: DbConnection,
  params: {
    dashboard: CreativeDashboardType;
    startDate: string;
    endDate: string;
    metric: EvalMetric;
    threshold: number;
    minSpend?: number;
  },
): Promise<CreativeDashboardResult> {
  const { dashboard, startDate, endDate, metric, threshold } = params;
  const minSpend = params.minSpend ?? 0;
  const currency = currencyOf(conn);
  const rows = await loadAdRows(conn, metric, threshold, startDate, endDate);

  switch (dashboard) {
    case "win_rate":
      return buildWinRate(rows, metric, threshold, currency);
    case "kill_scale":
      return buildKillScale(rows, metric, threshold, currency, minSpend);
    case "iteration":
      return buildIteration(rows, metric, threshold, currency, minSpend);
  }
}
