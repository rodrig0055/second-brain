import { tool } from "ai";
import { adAlerts, adCreatives, adNotes, integrationRecords, metricsDaily } from "@/db/schema";
import { and, asc, between, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import type { ToolBrand } from "../types";
import { extractConversions, type InsightRow } from "./client";
import { loadDailyTracker, loadPivot } from "@/lib/ads/store";
import { sumCounters, withRates, type AdTotals } from "@/lib/ads/metrics";
import { upsertAnnotation } from "@/lib/ads/annotations";
import { META_ADS_TEAM_SLUG } from "@/lib/workspaces";
import type { DbConnection } from "@/lib/integrations/types";

/**
 * Read-only Meta Ads audit tools, bound to one brand/connection. All read our
 * synced data (metrics_daily + ad_insight records) — no writes to the live
 * account. Dates are YYYY-MM-DD.
 */
export function metaTools(brand: ToolBrand) {
  return {
    metaSpend: tool({
      description:
        "Account-level Meta Ads performance for a date range: total spend, " +
        "impressions, link clicks, conversions (purchases), conversion value, " +
        "ROAS, CPA and CTR. Use for spend pacing and overall efficiency questions.",
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
                eq(metricsDaily.platform, "meta"),
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
            impressions: t.impressions,
            clicks: t.clicks,
            conversions: t.conversions,
            cpa: t.conversions > 0 ? (t.spend / t.conversions).toFixed(2) : null,
            ctr:
              t.impressions > 0
                ? ((t.clicks / t.impressions) * 100).toFixed(2) + "%"
                : null,
            rows: rows.map((r) => ({
              date: r.date,
              spend: r.spend,
              revenue: r.revenue,
              conversions: r.conversions,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    metaCampaignPerformance: tool({
      description:
        "Per-campaign Meta Ads performance for a date range, ranked by spend. " +
        "Returns spend, conversions, ROAS and CPA per campaign, and flags " +
        "campaigns that spent money with ZERO conversions (wasted spend).",
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
                eq(metricsDaily.platform, "meta"),
                ne(metricsDaily.dimensionKey, ""),
                between(metricsDaily.date, startDate, endDate),
              ),
            );

          type Agg = {
            campaignName: string;
            spend: number;
            revenue: number;
            conversions: number;
            impressions: number;
            clicks: number;
          };
          const byCampaign = new Map<string, Agg>();
          for (const r of rows) {
            const id = r.dimensionKey;
            const name = String(r.dimension.campaignName ?? id);
            const agg =
              byCampaign.get(id) ??
              {
                campaignName: name,
                spend: 0,
                revenue: 0,
                conversions: 0,
                impressions: 0,
                clicks: 0,
              };
            agg.spend += Number(r.spend);
            agg.revenue += Number(r.revenue);
            agg.conversions += r.conversions;
            agg.impressions += r.impressions;
            agg.clicks += r.clicks;
            byCampaign.set(id, agg);
          }

          const currency = rows[0]?.currency ?? "USD";
          const campaigns = [...byCampaign.entries()]
            .map(([id, a]) => ({
              campaignId: id,
              campaignName: a.campaignName,
              spend: a.spend.toFixed(2),
              revenue: a.revenue.toFixed(2),
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

    metaCreativeFatigue: tool({
      description:
        "Detect creative fatigue on Meta. For each ad active in the window, " +
        "compares CTR and frequency in the first half vs the second half of the " +
        "range and flags ads whose CTR is dropping or whose frequency is high " +
        "(audience oversaturation). Use to decide what creative to rotate.",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
        minImpressions: z
          .number()
          .optional()
          .describe("Ignore ads below this total impressions (default 1000)."),
      }),
      execute: async ({ startDate, endDate, minImpressions = 1000 }) => {
        try {
          const records = await db
            .select()
            .from(integrationRecords)
            .where(
              and(
                eq(integrationRecords.brandId, brand.id),
                eq(integrationRecords.platform, "meta"),
                eq(integrationRecords.recordType, "ad_insight"),
                between(integrationRecords.periodStart, startDate, endDate),
              ),
            );

          // Midpoint date splits the window into two halves.
          const mid = new Date(
            (new Date(startDate).getTime() + new Date(endDate).getTime()) / 2,
          )
            .toISOString()
            .slice(0, 10);

          type Half = { impressions: number; clicks: number; freqSum: number; n: number };
          type Agg = { name: string; first: Half; second: Half; impressions: number };
          const fresh = (): Half => ({ impressions: 0, clicks: 0, freqSum: 0, n: 0 });
          const byAd = new Map<string, Agg>();

          for (const rec of records) {
            const row = rec.data as unknown as InsightRow;
            const adId = row.ad_id;
            if (!adId) continue;
            const date = row.date_start;
            const imps = Number(row.impressions ?? 0);
            const clicks = Number(row.inline_link_clicks ?? row.clicks ?? 0);
            const freq = Number(row.frequency ?? 0);
            const agg =
              byAd.get(adId) ??
              { name: row.ad_name ?? adId, first: fresh(), second: fresh(), impressions: 0 };
            const half = date <= mid ? agg.first : agg.second;
            half.impressions += imps;
            half.clicks += clicks;
            half.freqSum += freq;
            half.n += 1;
            agg.impressions += imps;
            byAd.set(adId, agg);
          }

          const ctr = (h: Half) =>
            h.impressions > 0 ? (h.clicks / h.impressions) * 100 : 0;

          const ads = [...byAd.entries()]
            .filter(([, a]) => a.impressions >= minImpressions)
            .map(([id, a]) => {
              const firstCtr = ctr(a.first);
              const secondCtr = ctr(a.second);
              const ctrChangePct =
                firstCtr > 0 ? ((secondCtr - firstCtr) / firstCtr) * 100 : 0;
              const avgFrequency =
                a.second.n > 0 ? a.second.freqSum / a.second.n : 0;
              return {
                adId: id,
                adName: a.name,
                firstHalfCtr: firstCtr.toFixed(2) + "%",
                secondHalfCtr: secondCtr.toFixed(2) + "%",
                ctrChangePct: ctrChangePct.toFixed(0) + "%",
                avgFrequency: avgFrequency.toFixed(1),
                fatigued: ctrChangePct <= -15 || avgFrequency >= 3,
              };
            })
            .sort((x, y) => Number(x.ctrChangePct.replace("%", "")) - Number(y.ctrChangePct.replace("%", "")));

          return {
            adsAnalyzed: ads.length,
            fatiguedAds: ads.filter((a) => a.fatigued),
            allAds: ads,
            note:
              "Flagged when second-half CTR fell ≥15% vs first half, or average " +
              "frequency ≥3 (audience seeing the ad too often).",
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    metaCreativeInsights: tool({
      description:
        "Creative analytics on AI-classified Meta ads: win-rate by asset type, " +
        "messaging angle, hook tactic and funnel stage, plus the top and bottom " +
        "performing creatives for a date range. Only covers ads that have been " +
        "analyzed on the Dashboards → Meta Creative tab. A 'win' is judged " +
        "against the chosen metric + threshold (default ROAS ≥ 1.5).",
      inputSchema: z.object({
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
        metric: z
          .enum(["roas", "cpa", "ctr", "purchases"])
          .optional()
          .describe("Metric to judge winners by (default roas)."),
        threshold: z
          .number()
          .optional()
          .describe("Win threshold for the metric (default 1.5 for roas)."),
      }),
      execute: async ({ startDate, endDate, metric = "roas", threshold }) => {
        try {
          const cutoff = threshold ?? (metric === "roas" ? 1.5 : metric === "ctr" ? 1 : metric === "cpa" ? 20 : 1);

          const [records, creatives] = await Promise.all([
            db
              .select({ data: integrationRecords.data })
              .from(integrationRecords)
              .where(
                and(
                  eq(integrationRecords.brandId, brand.id),
                  eq(integrationRecords.platform, "meta"),
                  eq(integrationRecords.recordType, "ad_insight"),
                  between(integrationRecords.periodStart, startDate, endDate),
                ),
              ),
            db
              .select()
              .from(adCreatives)
              .where(eq(adCreatives.brandId, brand.id)),
          ]);

          type Stat = { spend: number; imps: number; clicks: number; conv: number; rev: number };
          const byAd = new Map<string, Stat>();
          for (const rec of records) {
            const row = rec.data as unknown as InsightRow;
            const adId = row.ad_id;
            if (!adId) continue;
            const { conversions, conversionValue } = extractConversions(row);
            const s = byAd.get(adId) ?? { spend: 0, imps: 0, clicks: 0, conv: 0, rev: 0 };
            s.spend += Number(row.spend ?? 0);
            s.imps += Number(row.impressions ?? 0);
            s.clicks += Number(row.inline_link_clicks ?? row.clicks ?? 0);
            s.conv += conversions;
            s.rev += conversionValue;
            byAd.set(adId, s);
          }

          const metricOf = (s: Stat): number | null => {
            const roas = s.spend > 0 ? s.rev / s.spend : 0;
            const cpa = s.conv > 0 ? s.spend / s.conv : null;
            const ctr = s.imps > 0 ? (s.clicks / s.imps) * 100 : 0;
            return metric === "roas" ? roas : metric === "cpa" ? cpa : metric === "ctr" ? ctr : s.conv;
          };
          const isWin = (v: number | null) => v !== null && (metric === "cpa" ? v <= cutoff : v >= cutoff);

          const rows = creatives
            .map((c) => {
              const s = byAd.get(c.adId);
              if (!s) return null;
              const value = metricOf(s);
              return {
                adId: c.adId,
                adName: c.adName,
                assetType: c.aiAssetType,
                messagingAngle: c.messagingAngle,
                hookTactic: c.hookTactic,
                funnelStage: c.funnelStage,
                spend: Number(s.spend.toFixed(2)),
                conversions: s.conv,
                metricValue: value === null ? null : Number(value.toFixed(2)),
                win: isWin(value),
              };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null && r.spend > 0);

          const dims = ["assetType", "messagingAngle", "hookTactic", "funnelStage"] as const;
          const winRateByCategory: Record<string, { category: string; ads: number; winRate: string; spend: number }[]> = {};
          for (const dim of dims) {
            const groups = new Map<string, { ads: number; wins: number; spend: number }>();
            for (const r of rows) {
              const key = String(r[dim] ?? "unclassified");
              const g = groups.get(key) ?? { ads: 0, wins: 0, spend: 0 };
              g.ads++;
              if (r.win) g.wins++;
              g.spend += r.spend;
              groups.set(key, g);
            }
            winRateByCategory[dim] = [...groups.entries()]
              .map(([category, g]) => ({
                category,
                ads: g.ads,
                winRate: g.ads > 0 ? ((g.wins / g.ads) * 100).toFixed(0) + "%" : "0%",
                spend: Number(g.spend.toFixed(2)),
              }))
              .sort((a, b) => b.spend - a.spend);
          }

          const bySpend = [...rows].sort((a, b) => b.spend - a.spend);
          return {
            metric,
            threshold: cutoff,
            classifiedAdsWithSpend: rows.length,
            winRateByCategory,
            topPerformers: bySpend.filter((r) => r.win).slice(0, 5),
            bottomPerformers: bySpend.filter((r) => !r.win).slice(0, 5),
            note:
              rows.length === 0
                ? "No classified creatives with spend in this window. Run 'Analyze creatives' on the Dashboards → Meta Creative tab first."
                : undefined,
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}

/**
 * Tools that read the same numbers the workspace shows.
 *
 * The four tools above answer aggregate questions from synced rows and are
 * deliberately funnel-blind. These go through `loadPivot`, which means a
 * funnel figure the agent quotes and the one on the Performance tab come from
 * one code path, and "which campaigns are running" stops being a question the
 * chat cannot answer at all.
 */
export function metaWorkspaceTools(
  brand: ToolBrand,
  conn: DbConnection,
  ctx: { teamSlug?: string; userId?: string } = {},
) {
  const currency = String(conn.config?.currency ?? "USD");

  return {
    metaEntities: tool({
      description:
        "List this brand's Meta campaigns, ad sets or ads over a window, with " +
        "spend, purchases, CIR, ROAS, status and the funnel a person assigned. " +
        "Use it for 'which campaigns are running', 'what is spending', or to " +
        "find a specific ad before asking about it.",
      inputSchema: z.object({
        level: z.enum(["campaign", "adset", "ad"]).default("ad"),
        startDate: z.string().describe("YYYY-MM-DD, inclusive."),
        endDate: z.string().describe("YYYY-MM-DD, inclusive."),
        campaignId: z.string().optional().describe("Narrow to one campaign."),
        adSetId: z.string().optional().describe("Narrow to one ad set."),
        funnel: z.enum(["TOF", "MOF", "BOF", "unmapped"]).optional(),
        limit: z.number().min(1).max(100).default(25),
      }),
      execute: async (input) => {
        try {
          const rows = await loadPivot({
            connectionId: conn.id,
            brandId: brand.id,
            level: input.level,
            range: { start: input.startDate, end: input.endDate },
            currency,
            filter: { campaignId: input.campaignId, adSetId: input.adSetId },
          });
          const filtered = input.funnel
            ? rows.filter((r) =>
                input.funnel === "unmapped" ? !r.funnel : r.funnel === input.funnel,
              )
            : rows;
          return {
            currency,
            level: input.level,
            count: filtered.length,
            rows: filtered.slice(0, input.limit).map((r) => ({
              id: r.id,
              name: r.name,
              status: r.status || null,
              funnel: r.funnel,
              funnelIsAGuess: r.funnelNeedsReview,
              campaign: r.campaignName,
              adSet: r.adSetName,
              spend: Number(r.totals.spend.toFixed(2)),
              purchases: r.totals.purchases,
              purchaseValue: Number(r.totals.purchaseValue.toFixed(2)),
              cir: r.totals.purchaseValue > 0 ? Number(r.totals.cir.toFixed(1)) : null,
              roas: r.totals.spend > 0 ? Number(r.totals.roas.toFixed(2)) : null,
              daysActive: r.daysActive,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    metaFunnelPerformance: tool({
      description:
        "Spend and CIR by funnel stage (TOF, MOF, BOF) for a window, plus the " +
        "spend sitting on ad sets nobody has assigned a funnel to. Use it for " +
        "'how is the funnel doing' or before judging whether a stage is over " +
        "its target.",
      inputSchema: z.object({
        startDate: z.string().describe("YYYY-MM-DD, inclusive."),
        endDate: z.string().describe("YYYY-MM-DD, inclusive."),
      }),
      execute: async (input) => {
        try {
          const tracker = await loadDailyTracker({
            connectionId: conn.id,
            brandId: brand.id,
            range: { start: input.startDate, end: input.endDate },
          });
          const byFunnel = new Map<string, AdTotals[]>();
          for (const row of tracker) {
            const list = byFunnel.get(row.funnel) ?? [];
            list.push(row.totals);
            byFunnel.set(row.funnel, list);
          }
          const funnels = [...byFunnel.entries()].map(([funnel, list]) => {
            const totals = withRates(sumCounters(list));
            return {
              funnel,
              spend: Number(totals.spend.toFixed(2)),
              purchases: totals.purchases,
              purchaseValue: Number(totals.purchaseValue.toFixed(2)),
              cir: totals.purchaseValue > 0 ? Number(totals.cir.toFixed(1)) : null,
            };
          });
          return {
            currency,
            funnels: funnels.sort((a, b) => b.spend - a.spend),
            unmappedSpend: funnels.find((f) => f.funnel === "UNMAPPED")?.spend ?? 0,
            note:
              "UNMAPPED is spend on ad sets nobody has assigned a funnel to, so it is " +
              "missing from every other row. It is a gap in the labelling, not a stage.",
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    metaAlerts: tool({
      description:
        "Open alerts on this ad account: which ads the rules flagged, why, and " +
        "whether the threshold has been confirmed for this brand or borrowed " +
        "from another.",
      inputSchema: z.object({
        state: z.enum(["open", "acknowledged", "all"]).default("open"),
        severity: z.enum(["critical", "warning"]).optional(),
        limit: z.number().min(1).max(100).default(25),
      }),
      execute: async (input) => {
        try {
          const states =
            input.state === "all" ? ["open", "acknowledged"] : [input.state];
          const rows = await db
            .select()
            .from(adAlerts)
            .where(
              and(
                eq(adAlerts.connectionId, conn.id),
                inArray(adAlerts.state, states),
                input.severity ? eq(adAlerts.severity, input.severity) : undefined,
              ),
            )
            .orderBy(desc(adAlerts.severity), desc(adAlerts.lastSeenAt))
            .limit(input.limit);

          return {
            count: rows.length,
            alerts: rows.map((a) => ({
              severity: a.severity === "critical" ? "kill" : "watch",
              entity: a.entityName || a.entityId,
              entityId: a.entityId,
              level: a.level,
              funnel: a.funnel,
              rule: a.ruleKey,
              message: a.message,
              observed: a.observed,
              threshold: a.threshold,
              thresholdConfirmedForThisBrand: a.confirmed,
              provisional: a.provisional,
              state: a.state,
            })),
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    // Writing an annotation is gated to the team that owns the surface, for the
    // same reason drafting a social post is: the autonomous loops engine calls
    // the tool builder with no team, and a background sweep should not be
    // relabelling somebody's funnels.
    ...(ctx.teamSlug === META_ADS_TEAM_SLUG && ctx.userId
      ? {
          metaAnnotate: tool({
            description:
              "Record a decision about a campaign, ad set or ad: its funnel " +
              "stage, its purpose, or whether it is an event ad set. This is " +
              "what makes a funnel count — the classifier's guess does not. " +
              "Say what you set and that it now drives the numbers.",
            inputSchema: z.object({
              level: z.enum(["campaign", "adset", "ad"]),
              entityId: z.string().min(1),
              entityName: z.string().default(""),
              funnel: z.enum(["TOF", "MOF", "BOF"]).optional(),
              purpose: z.string().optional(),
              isEventAdSet: z.boolean().optional(),
              note: z.string().optional().describe("Why, in a sentence."),
            }),
            execute: async (input) => {
              try {
                await upsertAnnotation(
                  {
                    level: input.level,
                    entityId: input.entityId,
                    entityName: input.entityName || undefined,
                    funnel: input.funnel,
                    purpose: input.purpose,
                    isEventAdSet: input.isEventAdSet,
                  },
                  {
                    connectionId: conn.id,
                    brandId: brand.id,
                    userId: ctx.userId!,
                    source: "chat",
                  },
                );
                if (input.note) {
                  await db.insert(adNotes).values({
                    connectionId: conn.id,
                    brandId: brand.id,
                    level: input.level,
                    entityId: input.entityId,
                    body: input.note,
                    source: "user",
                    authorId: ctx.userId!,
                  });
                }
                return {
                  ok: true,
                  message:
                    "Saved. This now drives the funnel figures on the Performance tab " +
                    "and the rules that judge it.",
                };
              } catch (err) {
                return { error: err instanceof Error ? err.message : String(err) };
              }
            },
          }),
        }
      : {}),
  };
}
