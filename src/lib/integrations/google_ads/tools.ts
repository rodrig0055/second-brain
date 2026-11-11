import { tool } from "ai";
import { z } from "zod";
import { and, asc, between, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { integrationRecords, metricsDaily } from "@/db/schema";
import type { ToolBrand } from "../types";

type SearchTermData = {
  searchTerm: string;
  campaignName: string;
  clicks: number;
  conversions: number;
  spend: number;
};

/**
 * Read-only Google Ads audit tools, bound to one brand. All read our synced data
 * (metrics_daily + search_term records) — no writes to the live account.
 */
export function googleAdsTools(brand: ToolBrand) {
  return {
    googleAdsSpend: tool({
      description:
        "Account-level Google Ads performance for a date range: spend, clicks, " +
        "conversions, conversion value, ROAS, CPA and CTR. Use for spend pacing " +
        "and overall efficiency. Dates are YYYY-MM-DD.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const rows = await db
            .select()
            .from(metricsDaily)
            .where(
              and(
                eq(metricsDaily.brandId, brand.id),
                eq(metricsDaily.platform, "google_ads"),
                eq(metricsDaily.dimensionKey, ""),
                between(metricsDaily.date, startDate, endDate),
              ),
            )
            .orderBy(asc(metricsDaily.date));

          const t = rows.reduce(
            (a, r) => {
              a.spend += Number(r.spend);
              a.revenue += Number(r.revenue);
              a.impressions += r.impressions;
              a.clicks += r.clicks;
              a.conversions += r.conversions;
              return a;
            },
            { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 },
          );
          const currency = rows[0]?.currency ?? "USD";
          return {
            currency,
            days: rows.length,
            spend: t.spend.toFixed(2),
            revenue: t.revenue.toFixed(2),
            roas: t.spend > 0 ? (t.revenue / t.spend).toFixed(2) : "0.00",
            clicks: t.clicks,
            conversions: t.conversions,
            cpa: t.conversions > 0 ? (t.spend / t.conversions).toFixed(2) : null,
            ctr:
              t.impressions > 0
                ? ((t.clicks / t.impressions) * 100).toFixed(2) + "%"
                : null,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    googleAdsCampaignPerformance: tool({
      description:
        "Per-campaign Google Ads performance for a date range, ranked by spend, " +
        "with ROAS/CPA and a flag for campaigns that spent with ZERO conversions.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const rows = await db
            .select()
            .from(metricsDaily)
            .where(
              and(
                eq(metricsDaily.brandId, brand.id),
                eq(metricsDaily.platform, "google_ads"),
                ne(metricsDaily.dimensionKey, ""),
                between(metricsDaily.date, startDate, endDate),
              ),
            );

          type Agg = {
            campaignName: string;
            spend: number;
            revenue: number;
            conversions: number;
          };
          const byCampaign = new Map<string, Agg>();
          for (const r of rows) {
            const id = r.dimensionKey;
            const agg =
              byCampaign.get(id) ??
              {
                campaignName: String(r.dimension.campaignName ?? id),
                spend: 0,
                revenue: 0,
                conversions: 0,
              };
            agg.spend += Number(r.spend);
            agg.revenue += Number(r.revenue);
            agg.conversions += r.conversions;
            byCampaign.set(id, agg);
          }
          const currency = rows[0]?.currency ?? "USD";
          const campaigns = [...byCampaign.entries()]
            .map(([id, a]) => ({
              campaignId: id,
              campaignName: a.campaignName,
              spend: a.spend.toFixed(2),
              conversions: a.conversions,
              roas: a.spend > 0 ? (a.revenue / a.spend).toFixed(2) : "0.00",
              cpa: a.conversions > 0 ? (a.spend / a.conversions).toFixed(2) : null,
              wastedSpend: a.conversions === 0 && a.spend > 0,
            }))
            .sort((x, y) => Number(y.spend) - Number(x.spend));
          return {
            currency,
            campaignCount: campaigns.length,
            wastedSpendCampaigns: campaigns.filter((c) => c.wastedSpend),
            campaigns,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    googleAdsWastedSearchTerms: tool({
      description:
        "Find Google Ads SEARCH TERMS that spent money with ZERO conversions in a " +
        "date range — the queries you're paying for that don't convert. Returns " +
        "them aggregated and ranked by wasted spend, ready to add as negative " +
        "keywords. Dates are YYYY-MM-DD.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
        minSpend: z
          .number()
          .optional()
          .describe("Only return terms whose wasted spend ≥ this (default 0)."),
      }),
      execute: async ({ startDate, endDate, minSpend = 0 }) => {
        try {
          const records = await db
            .select()
            .from(integrationRecords)
            .where(
              and(
                eq(integrationRecords.brandId, brand.id),
                eq(integrationRecords.platform, "google_ads"),
                eq(integrationRecords.recordType, "search_term"),
                between(integrationRecords.periodStart, startDate, endDate),
              ),
            );

          type Agg = {
            term: string;
            campaigns: Set<string>;
            clicks: number;
            conversions: number;
            spend: number;
          };
          const byTerm = new Map<string, Agg>();
          for (const rec of records) {
            const d = rec.data as unknown as SearchTermData;
            const agg =
              byTerm.get(d.searchTerm) ??
              {
                term: d.searchTerm,
                campaigns: new Set<string>(),
                clicks: 0,
                conversions: 0,
                spend: 0,
              };
            agg.campaigns.add(d.campaignName);
            agg.clicks += d.clicks;
            agg.conversions += d.conversions;
            agg.spend += d.spend;
            byTerm.set(d.searchTerm, agg);
          }

          const wasted = [...byTerm.values()]
            .filter((a) => a.conversions === 0 && a.spend > minSpend)
            .map((a) => ({
              searchTerm: a.term,
              campaigns: [...a.campaigns],
              clicks: a.clicks,
              wastedSpend: a.spend.toFixed(2),
            }))
            .sort((x, y) => Number(y.wastedSpend) - Number(x.wastedSpend));

          const totalWasted = wasted.reduce((s, w) => s + Number(w.wastedSpend), 0);
          return {
            wastedTermCount: wasted.length,
            totalWastedSpend: totalWasted.toFixed(2),
            terms: wasted,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
