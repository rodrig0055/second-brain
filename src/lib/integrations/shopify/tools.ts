import { tool } from "ai";
import { z } from "zod";
import { and, asc, between, eq } from "drizzle-orm";
import { db } from "@/db";
import { metricsDaily } from "@/db/schema";
import type { DbConnection, ToolBrand } from "../types";
import {
  resolveShopifyTarget,
  shopifyGraphql,
  shopifyShopInfo,
} from "./client";

/**
 * Tools the agent can call for a brand's Shopify store. `shopifySales` reads our
 * synced metrics_daily (fast, historical); `shopifyLiveToday` hits the Admin API
 * for right-now figures. Bound to a single brand/connection so the model can't
 * cross brands.
 */
export function shopifyTools(brand: ToolBrand, conn: DbConnection) {
  return {
    shopifySales: tool({
      description:
        "Get this brand's Shopify sales (orders count and revenue) per day from " +
        "our synced data, for a date range. Use for sales trends, week/month " +
        "comparisons, and revenue questions. Dates are YYYY-MM-DD. Returns daily " +
        "rows plus totals (revenue is in the store currency).",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const rows = await db
            .select({
              date: metricsDaily.date,
              orders: metricsDaily.orders,
              revenue: metricsDaily.revenue,
              currency: metricsDaily.currency,
            })
            .from(metricsDaily)
            .where(
              and(
                eq(metricsDaily.brandId, brand.id),
                eq(metricsDaily.platform, "shopify"),
                eq(metricsDaily.dimensionKey, ""),
                between(metricsDaily.date, startDate, endDate),
              ),
            )
            .orderBy(asc(metricsDaily.date));

          const totalOrders = rows.reduce((s, r) => s + r.orders, 0);
          const totalRevenue = rows.reduce((s, r) => s + Number(r.revenue), 0);
          const currency = rows[0]?.currency ?? "USD";
          return {
            currency,
            totalOrders,
            totalRevenue: totalRevenue.toFixed(2),
            averageOrderValue:
              totalOrders > 0 ? (totalRevenue / totalOrders).toFixed(2) : "0.00",
            days: rows.length,
            rows,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    shopifyLiveToday: tool({
      description:
        "Get this brand's Shopify orders and revenue so far TODAY, live from the " +
        "store (not the synced snapshot). Use only when the user asks about today / " +
        "right now. Also returns shop name and currency.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const target = await resolveShopifyTarget(conn);
          const shop = await shopifyShopInfo(target);
          const today = new Date().toISOString().slice(0, 10);
          const data = await shopifyGraphql<{
            orders: {
              nodes: {
                currentTotalPriceSet: { shopMoney: { amount: string } };
              }[];
            };
          }>(
            target,
            `query($q: String){ orders(first: 250, query: $q){ nodes { currentTotalPriceSet { shopMoney { amount } } } } }`,
            { q: `created_at:>=${today}` },
          );
          const nodes = data.orders.nodes;
          const revenue = nodes.reduce(
            (s, n) => s + Number(n.currentTotalPriceSet?.shopMoney?.amount ?? 0),
            0,
          );
          return {
            shop: shop.name,
            currency: shop.currencyCode,
            date: today,
            ordersToday: nodes.length,
            revenueToday: revenue.toFixed(2),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
