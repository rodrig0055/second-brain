import { db } from "@/db";
import { metricsDaily } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto";
import type { DbConnection, SyncResult, SyncWindow } from "../types";
import { runDailyReport } from "./client";
import { chunkWindow, parseReportRow } from "./shape";

/**
 * ETL one TikTok ad account into metrics_daily under platform `tiktok`, in the
 * same shape the Meta Ads sync uses so /insights and cross-platform readers
 * need nothing new:
 *
 *   dimensionKey ""              account totals per day
 *   dimensionKey <campaign_id>   one row per campaign per day
 *
 * Dates are the ad account's own days (TikTok reports in its time zone), and
 * revenue is website purchase value (`total_complete_payment_rate`), so ROAS
 * here means the same thing as Meta's purchase ROAS.
 */

async function upsert(
  conn: DbConnection,
  date: string,
  dimensionKey: string,
  dimension: Record<string, string>,
  m: ReturnType<typeof parseReportRow>,
  currency: string,
  extra: Record<string, unknown> = {},
) {
  const values = {
    impressions: m.impressions,
    clicks: m.clicks,
    conversions: m.purchases,
    spend: m.spend.toFixed(2),
    revenue: m.revenue.toFixed(2),
    currency,
    extra: {
      reach: m.reach,
      optimizationConversions: m.conversions,
      videoViews: m.videoViews,
      advertiserId: conn.externalAccountId,
      ...extra,
    },
  };
  await db
    .insert(metricsDaily)
    .values({ brandId: conn.brandId, platform: "tiktok", date, dimension, dimensionKey, ...values })
    .onConflictDoUpdate({
      target: [
        metricsDaily.brandId,
        metricsDaily.platform,
        metricsDaily.date,
        metricsDaily.dimensionKey,
      ],
      set: { dimension, ...values, syncedAt: new Date() },
    });
}

export async function syncTiktokAds(
  conn: DbConnection,
  window: SyncWindow,
): Promise<SyncResult> {
  if (!conn.encryptedCredentials) {
    throw new Error("TikTok Ads connection has no stored token; reconnect it.");
  }
  const { accessToken } = JSON.parse(decryptSecret(conn.encryptedCredentials)) as {
    accessToken: string;
  };
  const advertiserId = conn.externalAccountId;
  const currency = String(conn.config.currency ?? "USD");
  let rowsWritten = 0;

  for (const chunk of chunkWindow(window, 30)) {
    const account = await runDailyReport(accessToken, advertiserId, {
      dataLevel: "AUCTION_ADVERTISER",
      ...chunk,
    });
    for (const row of account) {
      const m = parseReportRow(row);
      if (!m.date) continue;
      await upsert(conn, m.date, "", {}, m, currency);
      rowsWritten++;
    }

    const campaigns = await runDailyReport(accessToken, advertiserId, {
      dataLevel: "AUCTION_CAMPAIGN",
      ...chunk,
      extraMetrics: ["campaign_name"],
    });
    for (const row of campaigns) {
      const m = parseReportRow(row);
      const campaignId = row.dimensions.campaign_id;
      if (!m.date || !campaignId) continue;
      // A campaign with no delivery that day still comes back as a zero row;
      // storing it only makes every reader filter it out again.
      if (m.spend === 0 && m.impressions === 0) continue;
      await upsert(
        conn,
        m.date,
        campaignId,
        { campaignId, campaignName: row.metrics.campaign_name ?? "" },
        m,
        currency,
        { campaignName: row.metrics.campaign_name ?? "" },
      );
      rowsWritten++;
    }
  }
  return { rowsWritten };
}
