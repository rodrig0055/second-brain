import { tool } from "ai";
import { z } from "zod";
import type { DbConnection, ToolBrand } from "../types";
import { resolveGa4Property, runGa4Report } from "./client";

/**
 * Read-only GA4 (Google Analytics 4) tools, bound to one brand/connection. Each
 * hits the GA4 Data API live (no local sync) via the shared service account,
 * scoped to the connection's property id. Dates are YYYY-MM-DD (GA4 relative
 * expressions like "28daysAgo"/"yesterday" also work). Currency/amounts are in
 * the property's own currency.
 */
const dateRange = {
  startDate: z.string().describe("Inclusive start date, YYYY-MM-DD (or GA4 relative e.g. '28daysAgo')."),
  endDate: z.string().describe("Inclusive end date, YYYY-MM-DD (or 'yesterday'/'today')."),
};

const num = (v: string | undefined) => Number(v ?? 0);

export function ga4Tools(brand: ToolBrand, conn: DbConnection) {
  const property = resolveGa4Property(conn);

  return {
    ga4Overview: tool({
      description:
        "Top-line GA4 site performance for a date range: sessions, users, new " +
        "users, pageviews, transactions, purchase revenue, engagement rate, plus " +
        "derived AOV and purchase-per-session rate. Use for overall traffic and " +
        "on-site conversion questions (not ad spend).",
      inputSchema: z.object(dateRange),
      execute: async ({ startDate, endDate }) => {
        try {
          const report = await runGa4Report({
            property,
            startDate,
            endDate,
            metrics: [
              "sessions",
              "totalUsers",
              "newUsers",
              "screenPageViews",
              "transactions",
              "purchaseRevenue",
              "engagementRate",
            ],
          });
          const r = report.rows[0] ?? {};
          const sessions = num(r.sessions);
          const transactions = num(r.transactions);
          const revenue = num(r.purchaseRevenue);
          return {
            currency: report.currency,
            sessions,
            totalUsers: num(r.totalUsers),
            newUsers: num(r.newUsers),
            pageViews: num(r.screenPageViews),
            transactions,
            purchaseRevenue: revenue.toFixed(2),
            engagementRate: (num(r.engagementRate) * 100).toFixed(1) + "%",
            aov: transactions > 0 ? (revenue / transactions).toFixed(2) : null,
            purchaseRate:
              sessions > 0
                ? ((transactions / sessions) * 100).toFixed(2) + "%"
                : null,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    ga4TrafficByChannel: tool({
      description:
        "GA4 traffic and revenue broken down by default channel group (Direct, " +
        "Paid Search, Paid Social, Organic Search, Email, etc.) for a date range, " +
        "ranked by sessions. Use to see which channels drive traffic and sales.",
      inputSchema: z.object(dateRange),
      execute: async ({ startDate, endDate }) => {
        try {
          const report = await runGa4Report({
            property,
            startDate,
            endDate,
            dimensions: ["sessionDefaultChannelGroup"],
            metrics: ["sessions", "totalUsers", "transactions", "purchaseRevenue"],
            orderByMetric: "sessions",
            limit: 25,
          });
          return {
            currency: report.currency,
            channels: report.rows.map((r) => {
              const sessions = num(r.sessions);
              const transactions = num(r.transactions);
              const revenue = num(r.purchaseRevenue);
              return {
                channel: r.sessionDefaultChannelGroup,
                sessions,
                users: num(r.totalUsers),
                transactions,
                revenue: revenue.toFixed(2),
                purchaseRate:
                  sessions > 0
                    ? ((transactions / sessions) * 100).toFixed(2) + "%"
                    : null,
              };
            }),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    ga4TopPages: tool({
      description:
        "Top GA4 landing pages for a date range, ranked by sessions: sessions, " +
        "pageviews, transactions and purchase revenue per landing page. Use to " +
        "find high-traffic entry pages and which of them convert.",
      inputSchema: z.object({
        ...dateRange,
        limit: z
          .number()
          .optional()
          .describe("Max landing pages to return (default 20)."),
      }),
      execute: async ({ startDate, endDate, limit = 20 }) => {
        try {
          const report = await runGa4Report({
            property,
            startDate,
            endDate,
            dimensions: ["landingPagePlusQueryString"],
            metrics: ["sessions", "screenPageViews", "transactions", "purchaseRevenue"],
            orderByMetric: "sessions",
            limit,
          });
          return {
            currency: report.currency,
            totalPages: report.rowCount,
            pages: report.rows.map((r) => ({
              landingPage: r.landingPagePlusQueryString,
              sessions: num(r.sessions),
              pageViews: num(r.screenPageViews),
              transactions: num(r.transactions),
              revenue: num(r.purchaseRevenue).toFixed(2),
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    ga4TopProducts: tool({
      description:
        "Top products (GA4 ecommerce items) for a date range, ranked by item " +
        "revenue: items purchased and item revenue per product. Use for " +
        "best-seller and product-performance questions.",
      inputSchema: z.object({
        ...dateRange,
        limit: z
          .number()
          .optional()
          .describe("Max products to return (default 20)."),
      }),
      execute: async ({ startDate, endDate, limit = 20 }) => {
        try {
          const report = await runGa4Report({
            property,
            startDate,
            endDate,
            dimensions: ["itemName"],
            metrics: ["itemsPurchased", "itemRevenue"],
            orderByMetric: "itemRevenue",
            limit,
          });
          return {
            currency: report.currency,
            totalProducts: report.rowCount,
            products: report.rows.map((r) => ({
              itemName: r.itemName,
              itemsPurchased: num(r.itemsPurchased),
              revenue: num(r.itemRevenue).toFixed(2),
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    ga4Trend: tool({
      description:
        "Daily GA4 time series for a date range: sessions, transactions and " +
        "purchase revenue per day. Use to spot trends, spikes or drops over time.",
      inputSchema: z.object(dateRange),
      execute: async ({ startDate, endDate }) => {
        try {
          const report = await runGa4Report({
            property,
            startDate,
            endDate,
            dimensions: ["date"],
            metrics: ["sessions", "transactions", "purchaseRevenue"],
            limit: 400,
          });
          // GA4 `date` dimension is YYYYMMDD; sort ascending and reformat.
          const days = report.rows
            .map((r) => ({
              date: r.date
                ? `${r.date.slice(0, 4)}-${r.date.slice(4, 6)}-${r.date.slice(6, 8)}`
                : r.date,
              sessions: num(r.sessions),
              transactions: num(r.transactions),
              revenue: num(r.purchaseRevenue).toFixed(2),
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
          return { currency: report.currency, days };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
