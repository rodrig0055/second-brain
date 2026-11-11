import { db } from "@/db";
import { integrationRecords, metricsDaily } from "@/db/schema";
import type { DbConnection, SyncResult, SyncWindow } from "../types";
import {
  gaql,
  googleAdsAccountInfo,
  microsToUnits,
  resolveGoogleAdsTarget,
} from "./client";

type CampaignRow = {
  campaign?: { id?: string; name?: string };
  segments?: { date?: string };
  metrics?: {
    impressions?: string;
    clicks?: string;
    conversions?: number;
    costMicros?: string;
    conversionsValue?: number;
  };
};

type SearchTermRow = {
  searchTermView?: { searchTerm?: string };
  campaign?: { id?: string; name?: string };
  segments?: { date?: string };
  metrics?: {
    clicks?: string;
    conversions?: number;
    costMicros?: string;
  };
};

/**
 * ETL a Google Ads account: campaign-level daily metrics (→ metrics_daily keyed
 * by campaign id, plus an account-level "" rollup) and search terms (→
 * integration_records, for the zero-conversion / wasted-spend audit). Read-only.
 */
export async function syncGoogleAds(
  conn: DbConnection,
  window: SyncWindow,
): Promise<SyncResult> {
  const target = await resolveGoogleAdsTarget(conn);
  const info = await googleAdsAccountInfo(target);
  const currency = info.currency;
  let rowsWritten = 0;

  // --- Campaign-level daily metrics ---
  const campaignRows = await gaql<CampaignRow>(
    target,
    `SELECT campaign.id, campaign.name, segments.date,
            metrics.impressions, metrics.clicks, metrics.conversions,
            metrics.cost_micros, metrics.conversions_value
     FROM campaign
     WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'`,
  );

  // Account-level rollup accumulates as we iterate campaigns.
  type Acc = {
    impressions: number;
    clicks: number;
    conversions: number;
    spend: number;
    revenue: number;
  };
  const accountByDate = new Map<string, Acc>();
  const freshAcc = (): Acc => ({
    impressions: 0,
    clicks: 0,
    conversions: 0,
    spend: 0,
    revenue: 0,
  });

  for (const row of campaignRows) {
    const date = row.segments?.date;
    const campaignId = row.campaign?.id;
    if (!date || !campaignId) continue;
    const m = row.metrics ?? {};
    const impressions = Math.round(Number(m.impressions ?? 0));
    const clicks = Math.round(Number(m.clicks ?? 0));
    const conversions = Math.round(Number(m.conversions ?? 0));
    const spend = microsToUnits(m.costMicros);
    const revenue = Number(m.conversionsValue ?? 0);

    const acc = accountByDate.get(date) ?? freshAcc();
    acc.impressions += impressions;
    acc.clicks += clicks;
    acc.conversions += conversions;
    acc.spend += spend;
    acc.revenue += revenue;
    accountByDate.set(date, acc);

    await db
      .insert(metricsDaily)
      .values({
        brandId: conn.brandId,
        platform: "google_ads",
        date,
        dimension: { campaignId, campaignName: row.campaign?.name ?? campaignId },
        dimensionKey: campaignId,
        impressions,
        clicks,
        conversions,
        spend: spend.toFixed(2),
        revenue: revenue.toFixed(2),
        currency,
      })
      .onConflictDoUpdate({
        target: [
          metricsDaily.brandId,
          metricsDaily.platform,
          metricsDaily.date,
          metricsDaily.dimensionKey,
        ],
        set: {
          dimension: { campaignId, campaignName: row.campaign?.name ?? campaignId },
          impressions,
          clicks,
          conversions,
          spend: spend.toFixed(2),
          revenue: revenue.toFixed(2),
          currency,
          syncedAt: new Date(),
        },
      });
    rowsWritten++;
  }

  // Upsert the account-level rollup ("").
  for (const [date, acc] of accountByDate) {
    await db
      .insert(metricsDaily)
      .values({
        brandId: conn.brandId,
        platform: "google_ads",
        date,
        dimensionKey: "",
        impressions: acc.impressions,
        clicks: acc.clicks,
        conversions: acc.conversions,
        spend: acc.spend.toFixed(2),
        revenue: acc.revenue.toFixed(2),
        currency,
      })
      .onConflictDoUpdate({
        target: [
          metricsDaily.brandId,
          metricsDaily.platform,
          metricsDaily.date,
          metricsDaily.dimensionKey,
        ],
        set: {
          impressions: acc.impressions,
          clicks: acc.clicks,
          conversions: acc.conversions,
          spend: acc.spend.toFixed(2),
          revenue: acc.revenue.toFixed(2),
          currency,
          syncedAt: new Date(),
        },
      });
    rowsWritten++;
  }

  // --- Search terms (for the wasted-spend audit) ---
  const termRows = await gaql<SearchTermRow>(
    target,
    `SELECT search_term_view.search_term, campaign.id, campaign.name, segments.date,
            metrics.clicks, metrics.conversions, metrics.cost_micros
     FROM search_term_view
     WHERE segments.date BETWEEN '${window.start}' AND '${window.end}'
       AND metrics.cost_micros > 0`,
  );
  for (const row of termRows) {
    const term = row.searchTermView?.searchTerm;
    const date = row.segments?.date;
    const campaignId = row.campaign?.id ?? "";
    if (!term || !date) continue;
    const externalId = `${date}:${campaignId}:${term}`;
    const data = {
      searchTerm: term,
      campaignId,
      campaignName: row.campaign?.name ?? campaignId,
      date,
      clicks: Math.round(Number(row.metrics?.clicks ?? 0)),
      conversions: Math.round(Number(row.metrics?.conversions ?? 0)),
      spend: microsToUnits(row.metrics?.costMicros),
    };
    await db
      .insert(integrationRecords)
      .values({
        connectionId: conn.id,
        brandId: conn.brandId,
        platform: "google_ads",
        recordType: "search_term",
        externalId,
        periodStart: date,
        periodEnd: date,
        data,
      })
      .onConflictDoUpdate({
        target: [
          integrationRecords.connectionId,
          integrationRecords.recordType,
          integrationRecords.externalId,
        ],
        set: { data, syncedAt: new Date() },
      });
    rowsWritten++;
  }

  return { rowsWritten };
}
