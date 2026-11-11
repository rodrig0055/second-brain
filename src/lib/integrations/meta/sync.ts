import { db } from "@/db";
import { integrationRecords, metricsDaily } from "@/db/schema";
import type { DbConnection, SyncResult, SyncWindow } from "../types";
import {
  extractConversions,
  fetchInsights,
  metaAccountInfo,
  resolveMetaTarget,
  type InsightRow,
  type MetaTarget,
} from "./client";
import { rowCounters } from "./counters";
import { syncMetaEntities } from "./entity-sync";

/** Split an inclusive date range into ≤chunkDays windows (YYYY-MM-DD). */
function dateChunks(start: string, end: string, chunkDays: number): [string, string][] {
  const out: [string, string][] = [];
  const day = 86_400_000;
  let s = new Date(start + "T00:00:00Z").getTime();
  const e = new Date(end + "T00:00:00Z").getTime();
  while (s <= e) {
    const chunkEnd = Math.min(s + (chunkDays - 1) * day, e);
    out.push([
      new Date(s).toISOString().slice(0, 10),
      new Date(chunkEnd).toISOString().slice(0, 10),
    ]);
    s = chunkEnd + day;
  }
  return out;
}

/**
 * Ad-level insights for a large account can exceed Meta's synchronous response
 * limit (returns a generic 500 / subcode 99). Fetch in small windows and merge.
 */
async function fetchAdInsightsChunked(
  target: MetaTarget,
  start: string,
  end: string,
): Promise<InsightRow[]> {
  // Per-day windows: a high-volume account exceeds Meta's sync response size
  // even for a week of ad-level rows. time_increment=1 already yields one row
  // per ad per day, so one-day windows keep each response small.
  const out: InsightRow[] = [];
  for (const [s, e] of dateChunks(start, end, 1)) {
    out.push(...(await fetchInsights(target, "ad", s, e)));
  }
  return out;
}

/**
 * Map one insight row → the numeric columns of metrics_daily.
 *
 * The named columns keep their existing meanings, because the dashboards and
 * the wiki ingest already read them. Everything the process doc's metrics need
 * goes into `extra`, which is jsonb and so costs no migration: landing page
 * views, add to cart, initiate checkout, outbound clicks and the video plays.
 *
 * `ctr` and `cpc` are stored as Meta reports them, for parity with Ads Manager.
 * Nothing should compute with them — lib/ads/metrics derives its own from the
 * counters, because a stored rate cannot be re-aggregated over any other window.
 */
function rowMetrics(row: InsightRow) {
  const { conversions, conversionValue } = extractConversions(row);
  const counters = rowCounters(row);
  return {
    impressions: Math.round(counters.impressions),
    clicks: Math.round(counters.linkClicks || counters.clicksAll),
    conversions: Math.round(conversions),
    spend: counters.spend,
    revenue: conversionValue,
    extra: {
      ctr: Number(row.ctr ?? 0),
      cpc: Number(row.cpc ?? 0),
      reach: Math.round(Number(row.reach ?? 0)),
      frequency: Number(row.frequency ?? 0),
      clicksAll: Math.round(counters.clicksAll),
      linkClicks: Math.round(counters.linkClicks),
      outboundClicks: Math.round(counters.outboundClicks),
      landingPageViews: Math.round(counters.landingPageViews),
      addToCart: Math.round(counters.addToCart),
      initiateCheckout: Math.round(counters.initiateCheckout),
      videoViews3s: Math.round(counters.videoViews3s),
      thruPlays: Math.round(counters.thruPlays),
    } as Record<string, unknown>,
  };
}

/**
 * ETL a Meta ad account: pull daily insights at account level (→ metrics_daily,
 * dimensionKey ""), campaign level (→ metrics_daily keyed by campaign id), and
 * ad level (→ integration_records, for creative-fatigue drill-downs). Read-only.
 */
export async function syncMeta(
  conn: DbConnection,
  window: SyncWindow,
): Promise<SyncResult> {
  const target = resolveMetaTarget(conn);
  const info = await metaAccountInfo(target);
  const currency = info.currency;

  let rowsWritten = 0;

  // --- Account-level daily metrics (dimensionKey "") ---
  const accountRows = await fetchInsights(
    target,
    "account",
    window.start,
    window.end,
  );
  for (const row of accountRows) {
    const m = rowMetrics(row);
    await db
      .insert(metricsDaily)
      .values({
        brandId: conn.brandId,
        platform: "meta",
        date: row.date_start,
        dimensionKey: "",
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
        spend: m.spend.toFixed(2),
        revenue: m.revenue.toFixed(2),
        currency,
        extra: m.extra,
      })
      .onConflictDoUpdate({
        target: [
          metricsDaily.brandId,
          metricsDaily.platform,
          metricsDaily.date,
          metricsDaily.dimensionKey,
        ],
        set: {
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.conversions,
          spend: m.spend.toFixed(2),
          revenue: m.revenue.toFixed(2),
          currency,
          extra: m.extra,
          syncedAt: new Date(),
        },
      });
    rowsWritten++;
  }

  // --- Campaign-level daily metrics (dimensionKey = campaign id) ---
  const campaignRows = await fetchInsights(
    target,
    "campaign",
    window.start,
    window.end,
  );
  for (const row of campaignRows) {
    if (!row.campaign_id) continue;
    const m = rowMetrics(row);
    await db
      .insert(metricsDaily)
      .values({
        brandId: conn.brandId,
        platform: "meta",
        date: row.date_start,
        dimension: {
          campaignId: row.campaign_id,
          campaignName: row.campaign_name ?? row.campaign_id,
        },
        dimensionKey: row.campaign_id,
        impressions: m.impressions,
        clicks: m.clicks,
        conversions: m.conversions,
        spend: m.spend.toFixed(2),
        revenue: m.revenue.toFixed(2),
        currency,
        extra: m.extra,
      })
      .onConflictDoUpdate({
        target: [
          metricsDaily.brandId,
          metricsDaily.platform,
          metricsDaily.date,
          metricsDaily.dimensionKey,
        ],
        set: {
          dimension: {
            campaignId: row.campaign_id,
            campaignName: row.campaign_name ?? row.campaign_id,
          },
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.conversions,
          spend: m.spend.toFixed(2),
          revenue: m.revenue.toFixed(2),
          currency,
          extra: m.extra,
          syncedAt: new Date(),
        },
      });
    rowsWritten++;
  }

  // --- Ad-set-level daily rows (integration_records) ---
  //
  // Not metrics_daily: the chat tools read every row with a non-empty
  // dimensionKey as a campaign, so ad-set rows there would be counted a second
  // time alongside the campaigns that contain them, and every spend total in
  // the agent's answers would roughly double.
  //
  // This is the level funnel actually lives at. Bloomly PH runs its MOF ad set
  // inside the TOF campaign, so campaign rows alone cannot separate the two.
  const adSetRows = await fetchInsights(
    target,
    "adset",
    window.start,
    window.end,
  );
  for (const row of adSetRows) {
    if (!row.adset_id) continue;
    await db
      .insert(integrationRecords)
      .values({
        connectionId: conn.id,
        brandId: conn.brandId,
        platform: "meta",
        recordType: "adset_insight",
        externalId: `${row.adset_id}:${row.date_start}`,
        periodStart: row.date_start,
        periodEnd: row.date_stop,
        data: row as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [
          integrationRecords.connectionId,
          integrationRecords.recordType,
          integrationRecords.externalId,
        ],
        set: {
          data: row as unknown as Record<string, unknown>,
          syncedAt: new Date(),
        },
      });
    rowsWritten++;
  }

  // --- Ad-level daily rows (integration_records, for creative-fatigue) ---
  const adRows = await fetchAdInsightsChunked(target, window.start, window.end);
  for (const row of adRows) {
    if (!row.ad_id) continue;
    const externalId = `${row.ad_id}:${row.date_start}`;
    await db
      .insert(integrationRecords)
      .values({
        connectionId: conn.id,
        brandId: conn.brandId,
        platform: "meta",
        recordType: "ad_insight",
        externalId,
        periodStart: row.date_start,
        periodEnd: row.date_stop,
        data: row as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [
          integrationRecords.connectionId,
          integrationRecords.recordType,
          integrationRecords.externalId,
        ],
        set: {
          data: row as unknown as Record<string, unknown>,
          syncedAt: new Date(),
        },
      });
    rowsWritten++;
  }

  // The account's configuration, not its performance. Everything above comes
  // from /insights, which reports delivery and has never carried objective,
  // budget, bid, schedule or targeting. This mirrors the three edges that do.
  //
  // Deliberately last and deliberately forgiving: the metrics are the reason
  // this job exists, and a configuration read that fails should not throw away
  // a window of spend that has already been written. A stale mirror announces
  // itself through `fetchedAt`, which is checked wherever it matters.
  try {
    const entities = await syncMetaEntities(conn);
    rowsWritten += entities.written;
    if (entities.truncated.length > 0) {
      console.warn(
        `[meta] ${entities.adAccountId}: hit the page cap on ` +
          `${entities.truncated.join(", ")} — the mirror is incomplete for ` +
          "those levels and anything reading it should be treated as partial.",
      );
    }
    if (entities.changed.length > 0) {
      console.info(
        `[meta] ${entities.adAccountId}: ${entities.changed.length} entity ` +
          "configuration(s) changed since the last sync",
      );
    }
  } catch (err) {
    console.error(
      "[meta] entity mirror failed, metrics kept:",
      err instanceof Error ? err.message : String(err),
    );
  }

  return { rowsWritten };
}
