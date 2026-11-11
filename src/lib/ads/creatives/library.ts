import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adCreatives } from "@/db/schema";
import { loadPivot, type PivotRow } from "@/lib/ads/store";
import type { MetaScopeBrand } from "@/lib/ads/scope";
import type { AdRow, EvalMetric } from "@/lib/integrations/meta/creative-dashboard-types";
import type { DateWindow } from "@/lib/date-range";
import type { Funnel } from "@/lib/ads/funnel";

/**
 * The creative library, across every account in scope.
 *
 * Built on the same pivot the Performance tab reads, so a creative's spend and
 * CIR here are the same numbers as its row there. The creative dashboards used
 * to compute their own totals from the raw insight rows, which meant the two
 * surfaces could and did disagree about the same ad.
 *
 * Both funnels travel with each row: `funnel` is what a person decided, and
 * `aiFunnelStage` is what the classifier guessed. They are shown side by side
 * rather than reconciled, because collapsing them would hide a disagreement
 * that is worth seeing.
 */

export type CreativeRow = {
  adId: string;
  adName: string;
  brandId: string;
  brandName: string;
  brandSlug: string;
  connectionId: string;
  adAccountId: string;
  currency: string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  objective: string;
  effectiveStatus: string;
  mediaType: string;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  body: string;
  title: string;
  assetType: string | null;
  messagingAngle: string | null;
  hookTactic: string | null;
  /** What the classifier guessed. */
  aiFunnelStage: string | null;
  confidence: number | null;
  classifiedAt: Date | null;
  /** What a person decided. */
  funnel: Funnel | null;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  roas: number;
  cpa: number | null;
  ctr: number;
  cir: number;
  hookRate: number;
  holdRate: number;
  frequency: number;
  daysActive: number;
  firstSeen: string;
  lastSeen: string;
  metricValue: number | null;
  isWinner: boolean;
};

function metricValueOf(
  metric: EvalMetric,
  row: { roas: number; cpa: number | null; ctr: number; conversions: number },
): number | null {
  switch (metric) {
    case "roas":
      return row.roas;
    case "cpa":
      return row.cpa;
    case "ctr":
      return row.ctr;
    case "purchases":
      return row.conversions;
  }
}

/** For CPA lower is better; for everything else higher is. */
function isWinnerOf(metric: EvalMetric, value: number | null, threshold: number): boolean {
  if (value === null) return false;
  return metric === "cpa" ? value <= threshold : value >= threshold;
}

export type LibraryOptions = {
  scope: MetaScopeBrand[];
  range: DateWindow;
  metric: EvalMetric;
  threshold: number;
};

export async function loadCreativeLibrary(
  opts: LibraryOptions,
): Promise<{ rows: CreativeRow[]; unclassified: number }> {
  const { scope, range, metric, threshold } = opts;
  if (scope.length === 0) return { rows: [], unclassified: 0 };

  const perAccount = await Promise.all(
    scope.map(async (account) => {
      const pivot = await loadPivot({
        connectionId: account.connection.id,
        brandId: account.brand.id,
        level: "ad",
        range,
        currency: account.currency,
        brand: { name: account.brand.name, slug: account.brand.slug },
        adAccountId: account.adAccountId,
        writeOk: account.writeGate.ok,
      });

      const ids = pivot.map((p) => p.id);
      const creatives = ids.length
        ? await db
            .select()
            .from(adCreatives)
            .where(
              and(
                eq(adCreatives.connectionId, account.connection.id),
                inArray(adCreatives.adId, ids),
              ),
            )
        : [];
      const byId = new Map(creatives.map((c) => [c.adId, c]));

      const rows = pivot.map((p: PivotRow): CreativeRow => {
        const c = byId.get(p.id);
        const t = p.totals;
        const roas = t.spend > 0 ? t.purchaseValue / t.spend : 0;
        const cpa = t.purchases > 0 ? t.spend / t.purchases : null;
        const ctr = t.ctr;
        const value = metricValueOf(metric, {
          roas,
          cpa,
          ctr,
          conversions: t.purchases,
        });

        return {
          adId: p.id,
          adName: p.name,
          brandId: account.brand.id,
          brandName: account.brand.name,
          brandSlug: account.brand.slug,
          connectionId: account.connection.id,
          adAccountId: account.adAccountId,
          currency: account.currency,
          campaignId: p.campaignId,
          campaignName: p.campaignName,
          adSetId: p.adSetId,
          adSetName: p.adSetName,
          objective: c?.objective ?? "",
          effectiveStatus: c?.effectiveStatus ?? "",
          mediaType: c?.mediaType ?? "",
          thumbnailUrl: c?.thumbnailUrl ?? null,
          imageUrl: c?.imageUrl ?? null,
          body: c?.body ?? "",
          title: c?.title ?? "",
          assetType: p.assetType ?? c?.aiAssetType ?? null,
          messagingAngle: p.messagingAngle ?? c?.messagingAngle ?? null,
          hookTactic: p.hookTactic ?? c?.hookTactic ?? null,
          aiFunnelStage: c?.funnelStage ?? null,
          confidence: c?.confidence === null || c?.confidence === undefined ? null : Number(c.confidence),
          classifiedAt: c?.classifiedAt ?? null,
          funnel: p.funnel,
          spend: t.spend,
          impressions: t.impressions,
          clicks: t.outboundClicks,
          conversions: t.purchases,
          revenue: t.purchaseValue,
          roas,
          cpa,
          ctr,
          cir: t.cir,
          hookRate: t.hookRate,
          holdRate: t.holdRate,
          frequency: p.reach.frequency,
          daysActive: p.daysActive,
          firstSeen: p.firstSeen,
          lastSeen: p.lastSeen,
          metricValue: value,
          isWinner: isWinnerOf(metric, value, threshold),
        };
      });

      return rows;
    }),
  );

  const rows = perAccount.flat().sort((a, b) => b.spend - a.spend);
  const unclassified = rows.filter((r) => !r.classifiedAt).length;
  return { rows, unclassified };
}

/** The shape the existing win-rate and kill-scale builders expect. */
export function toAdRow(row: CreativeRow): AdRow {
  return {
    adId: row.adId,
    adName: row.adName,
    campaignName: row.campaignName,
    mediaType: row.mediaType,
    thumbnailUrl: row.thumbnailUrl,
    assetType: row.assetType,
    messagingAngle: row.messagingAngle,
    hookTactic: row.hookTactic,
    funnelStage: row.aiFunnelStage,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    conversions: row.conversions,
    revenue: row.revenue,
    roas: row.roas,
    cpa: row.cpa,
    ctr: row.ctr,
    metricValue: row.metricValue,
    isWinner: row.isWinner,
  };
}
