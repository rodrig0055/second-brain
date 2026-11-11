import { tool } from "ai";
import { z } from "zod";
import { and, between, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { metricsDaily } from "@/db/schema";
import type { ToolBrand } from "../types";

/**
 * TikTok Ads performance for one brand, from the rows syncTiktokAds wrote.
 * Read-only; there are no TikTok Ads write paths in the app.
 */

const LATENCY_NOTE =
  "TikTok finalizes ads data about 48h after the day ends (ad account time " +
  "zone); the last two days can still move. Revenue is website purchase value " +
  "(complete_payment), so ROAS = revenue / spend is purchase ROAS.";

type Totals = {
  spend: number;
  revenue: number;
  purchases: number;
  impressions: number;
  clicks: number;
};

function finish(t: Totals) {
  return {
    spend: +t.spend.toFixed(2),
    revenue: +t.revenue.toFixed(2),
    purchases: t.purchases,
    impressions: t.impressions,
    clicks: t.clicks,
    roas: t.spend > 0 ? +(t.revenue / t.spend).toFixed(2) : null,
    cpa: t.purchases > 0 ? +(t.spend / t.purchases).toFixed(2) : null,
    ctr: t.impressions > 0 ? `${((t.clicks / t.impressions) * 100).toFixed(2)}%` : null,
    cpm: t.impressions > 0 ? +((t.spend / t.impressions) * 1000).toFixed(2) : null,
  };
}

export function tiktokAdsTools(brand: ToolBrand) {
  return {
    tiktokAdsPerformance: tool({
      description:
        "This brand's TikTok Ads results for a date range: spend, purchase value, " +
        "purchases, ROAS, CPA, CTR and CPM, as totals, per day, and per campaign. " +
        "Dates are the ad account's own days. Use for any TikTok ads question.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
      }),
      execute: async ({ startDate, endDate }) => {
        try {
          const base = and(
            eq(metricsDaily.brandId, brand.id),
            eq(metricsDaily.platform, "tiktok"),
            between(metricsDaily.date, startDate, endDate),
          );
          const [accountRows, campaignRows] = await Promise.all([
            db.select().from(metricsDaily).where(and(base, eq(metricsDaily.dimensionKey, ""))),
            db.select().from(metricsDaily).where(and(base, ne(metricsDaily.dimensionKey, ""))),
          ]);
          if (accountRows.length === 0) {
            return { brand: brand.name, note: "No TikTok Ads data synced for this range." };
          }
          const zero = (): Totals => ({ spend: 0, revenue: 0, purchases: 0, impressions: 0, clicks: 0 });
          const add = (t: Totals, r: (typeof accountRows)[number]) => {
            t.spend += Number(r.spend);
            t.revenue += Number(r.revenue);
            t.purchases += r.conversions;
            t.impressions += r.impressions;
            t.clicks += r.clicks;
          };

          const total = zero();
          const byDay = new Map<string, Totals>();
          for (const r of accountRows) {
            add(total, r);
            const d = byDay.get(r.date) ?? zero();
            add(d, r);
            byDay.set(r.date, d);
          }
          const byCampaign = new Map<string, Totals & { name: string }>();
          for (const r of campaignRows) {
            const c = byCampaign.get(r.dimensionKey) ?? {
              ...zero(),
              name: String(r.dimension.campaignName ?? r.dimensionKey),
            };
            add(c, r);
            byCampaign.set(r.dimensionKey, c);
          }

          return {
            brand: brand.name,
            currency: accountRows[0].currency,
            note: LATENCY_NOTE,
            totals: finish(total),
            days: [...byDay.entries()].sort().map(([date, t]) => ({ date, ...finish(t) })),
            campaigns: [...byCampaign.entries()]
              .map(([id, c]) => ({ campaignId: id, name: c.name, ...finish(c) }))
              .sort((a, b) => b.spend - a.spend),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
