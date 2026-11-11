import { db } from "@/db";
import { integrationRecords, metricsDaily } from "@/db/schema";
import type { DbConnection, SyncResult, SyncWindow } from "../types";
import { fetchBrandCampaigns, type BrandCampaign } from "./client";

/** Sender-email domain this connection is scoped to (stored at connect time). */
function connDomain(conn: DbConnection): string {
  return String(conn.config.senderDomain ?? conn.externalAccountId ?? "").toLowerCase();
}

type DayAgg = { emailsSent: number; opens: number; clicks: number };

async function upsertDaily(
  brandId: string,
  date: string,
  dimensionKey: string,
  dimension: Record<string, string>,
  m: DayAgg,
) {
  await db
    .insert(metricsDaily)
    .values({
      brandId,
      platform: "sendpulse",
      date,
      dimension,
      dimensionKey,
      emailsSent: m.emailsSent,
      opens: m.opens,
      clicks: m.clicks,
    })
    .onConflictDoUpdate({
      target: [
        metricsDaily.brandId,
        metricsDaily.platform,
        metricsDaily.date,
        metricsDaily.dimensionKey,
      ],
      set: {
        dimension,
        emailsSent: m.emailsSent,
        opens: m.opens,
        clicks: m.clicks,
        syncedAt: new Date(),
      },
    });
}

/**
 * ETL a brand's SendPulse email campaigns for the window into metrics_daily:
 * per-campaign rows (dimensionKey = campaign id) and a per-day account-level
 * roll-up (dimensionKey ""). Raw campaigns are also kept in integration_records.
 * Read-only against SendPulse.
 */
export async function syncSendpulse(
  conn: DbConnection,
  window: SyncWindow,
): Promise<SyncResult> {
  const domain = connDomain(conn);
  if (!domain) throw new Error("SendPulse connection has no sender domain configured.");

  const campaigns = await fetchBrandCampaigns(domain, window.start, window.end, 500);
  let rowsWritten = 0;

  // Per-campaign rows + per-day account roll-up.
  const byDay = new Map<string, DayAgg>();
  for (const c of campaigns) {
    const m: DayAgg = {
      emailsSent: c.stats.sent,
      opens: c.stats.opened,
      clicks: c.stats.clicked,
    };
    await upsertDaily(
      conn.brandId,
      c.date,
      String(c.id),
      {
        campaignId: String(c.id),
        campaignName: c.name ?? String(c.id),
        subject: c.message?.subject ?? "",
      },
      m,
    );
    rowsWritten++;

    const day = byDay.get(c.date) ?? { emailsSent: 0, opens: 0, clicks: 0 };
    day.emailsSent += m.emailsSent;
    day.opens += m.opens;
    day.clicks += m.clicks;
    byDay.set(c.date, day);

    await storeRecord(conn, c);
  }

  for (const [date, m] of byDay) {
    await upsertDaily(conn.brandId, date, "", {}, m);
    rowsWritten++;
  }

  return { rowsWritten };
}

async function storeRecord(conn: DbConnection, c: BrandCampaign) {
  await db
    .insert(integrationRecords)
    .values({
      connectionId: conn.id,
      brandId: conn.brandId,
      platform: "sendpulse",
      recordType: "email_campaign",
      externalId: String(c.id),
      periodStart: c.date,
      periodEnd: c.date,
      data: { ...c } as unknown as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [
        integrationRecords.connectionId,
        integrationRecords.recordType,
        integrationRecords.externalId,
      ],
      set: { data: { ...c } as unknown as Record<string, unknown>, syncedAt: new Date() },
    });
}
