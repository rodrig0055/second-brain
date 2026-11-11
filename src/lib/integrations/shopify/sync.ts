import { db } from "@/db";
import { integrationRecords, metricsDaily } from "@/db/schema";
import type { DbConnection, SyncResult, SyncWindow } from "../types";
import { resolveShopifyTarget, shopifyGraphql, type ShopifyTarget } from "./client";

type OrderNode = {
  id: string;
  createdAt: string;
  currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  displayFinancialStatus: string | null;
};

const ORDERS_QUERY = `
query Orders($cursor: String, $query: String) {
  orders(first: 100, after: $cursor, query: $query, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      createdAt
      displayFinancialStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
    }
  }
}`;

const MAX_PAGES = 50; // safety cap (≈5000 orders per sync)

async function fetchOrders(
  target: ShopifyTarget,
  window: SyncWindow,
): Promise<OrderNode[]> {
  const filter = `created_at:>=${window.start} created_at:<=${window.end}`;
  const out: OrderNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: {
      orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: OrderNode[] };
    } = await shopifyGraphql(target, ORDERS_QUERY, { cursor, query: filter });
    out.push(...data.orders.nodes);
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return out;
}

/**
 * ETL a Shopify store: pull orders in the window, store each as an
 * integration_record, and upsert per-day revenue/order counts into
 * metrics_daily (account-level, dimensionKey "").
 */
export async function syncShopify(
  conn: DbConnection,
  window: SyncWindow,
): Promise<SyncResult> {
  const target = await resolveShopifyTarget(conn);
  const orders = await fetchOrders(target, window);

  // Aggregate per calendar day (UTC date portion of createdAt).
  type DayAgg = { orders: number; revenue: number; currency: string };
  const byDay = new Map<string, DayAgg>();
  for (const o of orders) {
    const date = o.createdAt.slice(0, 10);
    const money = o.currentTotalPriceSet?.shopMoney;
    const amount = money ? Number(money.amount) : 0;
    const agg = byDay.get(date) ?? { orders: 0, revenue: 0, currency: money?.currencyCode ?? "USD" };
    agg.orders += 1;
    agg.revenue += Number.isFinite(amount) ? amount : 0;
    byDay.set(date, agg);
  }

  let rowsWritten = 0;

  // Upsert daily metrics.
  for (const [date, agg] of byDay) {
    await db
      .insert(metricsDaily)
      .values({
        brandId: conn.brandId,
        platform: "shopify",
        date,
        dimensionKey: "",
        orders: agg.orders,
        revenue: agg.revenue.toFixed(2),
        currency: agg.currency,
      })
      .onConflictDoUpdate({
        target: [
          metricsDaily.brandId,
          metricsDaily.platform,
          metricsDaily.date,
          metricsDaily.dimensionKey,
        ],
        set: {
          orders: agg.orders,
          revenue: agg.revenue.toFixed(2),
          currency: agg.currency,
          syncedAt: new Date(),
        },
      });
    rowsWritten++;
  }

  // Upsert each order as an entity record (handy for drill-downs / audits).
  for (const o of orders) {
    await db
      .insert(integrationRecords)
      .values({
        connectionId: conn.id,
        brandId: conn.brandId,
        platform: "shopify",
        recordType: "order",
        externalId: o.id,
        periodStart: o.createdAt.slice(0, 10),
        periodEnd: o.createdAt.slice(0, 10),
        data: o as unknown as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [
          integrationRecords.connectionId,
          integrationRecords.recordType,
          integrationRecords.externalId,
        ],
        set: { data: o as unknown as Record<string, unknown>, syncedAt: new Date() },
      });
  }

  return { rowsWritten };
}
