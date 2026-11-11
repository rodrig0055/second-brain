import { getCache } from "@vercel/functions";
import { z } from "zod";
import type { DbConnection } from "@/lib/integrations/types";
import { resolveMetaTarget } from "./client";

export const META_DATE_PRESETS = [
  "today",
  "yesterday",
  "last_3d",
  "last_7d",
  "last_14d",
  "last_30d",
  "last_90d",
  "this_month",
  "last_month",
] as const;

export type MetaDatePreset = (typeof META_DATE_PRESETS)[number];
export type MetaDateSelection =
  | { datePreset: MetaDatePreset }
  | { since: string; until: string };

const actionSchema = z.object({
  action_type: z.string(),
  value: z.string(),
});

const insightRowSchema = z
  .object({
    account_id: z.string(),
    account_name: z.string().optional(),
    account_currency: z.string().optional(),
    date_start: z.string(),
    date_stop: z.string(),
    spend: z.string().optional(),
    impressions: z.string().optional(),
    clicks: z.string().optional(),
    inline_link_clicks: z.string().optional(),
    ctr: z.string().optional(),
    actions: z.array(actionSchema).optional(),
    action_values: z.array(actionSchema).optional(),
    campaign_id: z.string().optional(),
    campaign_name: z.string().optional(),
    adset_id: z.string().optional(),
    adset_name: z.string().optional(),
    ad_id: z.string().optional(),
    ad_name: z.string().optional(),
  })
  .passthrough();

export type MetaCliInsightRow = z.infer<typeof insightRowSchema>;

const serviceSuccessSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    data: z.array(insightRowSchema),
    paging: z.unknown().optional(),
  }),
  meta: z.object({
    cacheHit: z.boolean(),
    durationMs: z.number(),
  }),
});

const serviceErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});

const serviceResponseSchema = z.union([serviceSuccessSchema, serviceErrorSchema]);

const metaAdReportSchema = z.object({
  grain: z.literal("ad"),
  range: z.object({
    start: z.string(),
    end: z.string(),
    timezone: z.string(),
  }),
  currency: z.string(),
  account: z.object({ id: z.string(), name: z.string() }),
  ad: z.object({ id: z.string(), name: z.string() }),
  adSet: z.object({ id: z.string(), name: z.string() }),
  campaign: z.object({ id: z.string(), name: z.string() }),
  metrics: z.object({
    spend: z.number().finite(),
    purchases: z.number().finite(),
    conversionValue: z.number().finite(),
    cir: z.number().finite().nullable(),
    roas: z.number().finite().nullable(),
    impressions: z.number().finite(),
    clicks: z.number().finite(),
    linkClicks: z.number().finite(),
    landingPageViews: z.number().finite(),
    ctrAll: z.number().finite().nullable(),
    ctrLink: z.number().finite().nullable(),
    landingPageViewRate: z.number().finite().nullable(),
  }),
  source: z.object({
    provider: z.literal("meta-ads-cli"),
    live: z.literal(true),
    fetchedAt: z.string(),
    cacheHit: z.boolean(),
    durationMs: z.number().finite(),
  }),
});

export type MetaAdReport = z.infer<typeof metaAdReportSchema>;

// Vercel supplies a shared regional Runtime Cache in production. Locally, the
// same API falls back to an in-process cache. Keys are hashed by the SDK and
// never include the access token.
const reportCache = getCache({ namespace: "meta-ad-report-v1" });

function cacheTtlSeconds(): number {
  const value = Number(process.env.META_CLI_CACHE_TTL_SECONDS ?? 120);
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), 900)) : 120;
}

function reportCacheKey(args: {
  accountId: string;
  adId: string;
  dates: MetaDateSelection;
}): string {
  const range =
    "datePreset" in args.dates
      ? `preset:${args.dates.datePreset}`
      : `range:${args.dates.since}:${args.dates.until}`;
  return `${normalizeAccountId(args.accountId)}:${args.adId}:${range}`;
}

function numeric(value: string | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function actionValue(
  rows: { action_type: string; value: string }[] | undefined,
  type: string,
): number {
  return numeric(rows?.find((row) => row.action_type === type)?.value);
}

function purchaseValue(
  rows: { action_type: string; value: string }[] | undefined,
): number {
  for (const type of [
    "omni_purchase",
    "offsite_conversion.fb_pixel_purchase",
    "purchase",
  ]) {
    const match = rows?.find((row) => row.action_type === type);
    if (match) return numeric(match.value);
  }
  return numeric(rows?.find((row) => row.action_type.endsWith("purchase"))?.value);
}

function normalizeAccountId(value: string): string {
  return value.replace(/^act_/, "");
}

export function buildMetaAdReport(args: {
  row: MetaCliInsightRow;
  requestedAdId: string;
  expectedAccountId: string;
  currency: string;
  timezone: string;
  cacheHit?: boolean;
  durationMs?: number;
  fetchedAt?: string;
}): MetaAdReport {
  const { row, requestedAdId } = args;
  if (row.ad_id !== requestedAdId) {
    throw new Error("Meta returned a different ad than requested");
  }
  if (normalizeAccountId(row.account_id) !== normalizeAccountId(args.expectedAccountId)) {
    throw new Error("Meta returned data from a different ad account");
  }
  if (!row.campaign_id || !row.adset_id) {
    throw new Error("Meta did not return the ad hierarchy");
  }

  const spend = numeric(row.spend);
  const purchases = purchaseValue(row.actions);
  const conversionValue = purchaseValue(row.action_values);
  const impressions = numeric(row.impressions);
  const clicks = numeric(row.clicks);
  const linkClicks = numeric(row.inline_link_clicks);
  const landingPageViews = actionValue(row.actions, "landing_page_view");

  return {
    grain: "ad",
    range: {
      start: row.date_start,
      end: row.date_stop,
      timezone: args.timezone,
    },
    currency: row.account_currency ?? args.currency,
    account: {
      id: row.account_id,
      name: row.account_name ?? "Meta ad account",
    },
    ad: { id: requestedAdId, name: row.ad_name ?? requestedAdId },
    adSet: { id: row.adset_id, name: row.adset_name ?? row.adset_id },
    campaign: {
      id: row.campaign_id,
      name: row.campaign_name ?? row.campaign_id,
    },
    metrics: {
      spend,
      purchases,
      conversionValue,
      cir: conversionValue > 0 ? (spend / conversionValue) * 100 : null,
      roas: spend > 0 ? conversionValue / spend : null,
      impressions,
      clicks,
      linkClicks,
      landingPageViews,
      ctrAll: impressions > 0 ? (clicks / impressions) * 100 : null,
      ctrLink: impressions > 0 ? (linkClicks / impressions) * 100 : null,
      landingPageViewRate:
        linkClicks > 0 ? (landingPageViews / linkClicks) * 100 : null,
    },
    source: {
      provider: "meta-ads-cli",
      live: true,
      fetchedAt: args.fetchedAt ?? new Date().toISOString(),
      cacheHit: args.cacheHit ?? false,
      durationMs: args.durationMs ?? 0,
    },
  };
}

export async function getMetaAdReport(args: {
  connection: DbConnection;
  adId: string;
  dates: MetaDateSelection;
  requestUrl: string;
}): Promise<MetaAdReport> {
  const target = resolveMetaTarget(args.connection);
  const ttl = cacheTtlSeconds();
  const cacheKey = reportCacheKey({
    accountId: target.accountId,
    adId: args.adId,
    dates: args.dates,
  });
  if (ttl > 0) {
    try {
      const cached = metaAdReportSchema.safeParse(await reportCache.get(cacheKey));
      if (cached.success) {
        // Re-check the two identity boundaries even for a validated cache item.
        if (
          cached.data.ad.id === args.adId &&
          normalizeAccountId(cached.data.account.id) ===
            normalizeAccountId(target.accountId)
        ) {
          return {
            ...cached.data,
            source: { ...cached.data.source, cacheHit: true, durationMs: 0 },
          };
        }
        await reportCache.delete(cacheKey);
      }
    } catch (error) {
      // Cache availability must never prevent a live, authoritative lookup.
      console.warn("meta_runtime_cache_read_failed", {
        adId: args.adId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const secret =
    process.env.META_CLI_INTERNAL_SECRET ?? process.env.CRON_SECRET;
  if (!secret) throw new Error("Meta CLI internal secret is not configured");

  const endpoint =
    process.env.META_CLI_URL ??
    new URL("/api/meta-insights", args.requestUrl).toString();
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      adId: args.adId,
      adAccountId: target.accountId,
      accessToken: target.accessToken,
      ...args.dates,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Meta CLI service returned HTTP ${res.status}`);
  }
  const parsed = serviceResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error("Meta CLI service returned invalid data");
  if (!res.ok || !parsed.data.ok) {
    const detail = parsed.data.ok ? `HTTP ${res.status}` : parsed.data.error;
    throw new Error(`Meta CLI lookup failed: ${detail}`);
  }
  if (parsed.data.result.data.length === 0) {
    throw new Error("Meta returned no data for this ad and date range");
  }
  if (parsed.data.result.data.length !== 1) {
    throw new Error("Meta returned an unexpected number of rows");
  }

  const report = buildMetaAdReport({
    row: parsed.data.result.data[0],
    requestedAdId: args.adId,
    expectedAccountId: target.accountId,
    currency: String(args.connection.config.currency ?? "USD"),
    timezone: String(args.connection.config.timezone ?? "UTC"),
    cacheHit: parsed.data.meta.cacheHit,
    durationMs: parsed.data.meta.durationMs,
  });
  if (ttl > 0) {
    try {
      await reportCache.set(cacheKey, report, {
        ttl,
        tags: [`meta-account-${normalizeAccountId(target.accountId)}`],
        name: "Meta ad report",
      });
    } catch (error) {
      console.warn("meta_runtime_cache_write_failed", {
        adId: args.adId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  return report;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").trim();
}

function money(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function percent(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}%`;
}

export function formatMetaAdReport(report: MetaAdReport): string {
  const m = report.metrics;
  return [
    `## Meta ad performance`,
    "",
    `**Date range:** ${report.range.start} to ${report.range.end} (${escapeTable(report.range.timezone)})  `,
    `**Ad:** ${escapeTable(report.ad.name)} (\`${report.ad.id}\`)  `,
    `**Ad set:** ${escapeTable(report.adSet.name)} (\`${report.adSet.id}\`)  `,
    `**Campaign:** ${escapeTable(report.campaign.name)} (\`${report.campaign.id}\`)`,
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Spend | ${money(m.spend, report.currency)} |`,
    `| Purchases | ${m.purchases.toLocaleString("en-US")} |`,
    `| Conversion value | ${money(m.conversionValue, report.currency)} |`,
    `| CIR | ${percent(m.cir)} |`,
    `| ROAS | ${m.roas === null ? "—" : `${m.roas.toFixed(2)}x`} |`,
    `| Impressions | ${m.impressions.toLocaleString("en-US")} |`,
    `| Clicks (all) | ${m.clicks.toLocaleString("en-US")} |`,
    `| CTR (all) | ${percent(m.ctrAll)} |`,
    `| Link clicks | ${m.linkClicks.toLocaleString("en-US")} |`,
    `| Link CTR | ${percent(m.ctrLink)} |`,
    `| Landing page views | ${m.landingPageViews.toLocaleString("en-US")} |`,
    `| Landing page view rate | ${percent(m.landingPageViewRate)} |`,
    "",
    `_Purchases and conversion value use Meta's unified purchase action and the ad account's attribution settings._`,
    "",
    `_Source: live Meta Ads CLI · ${report.source.cacheHit ? "cached result" : `fetched in ${(report.source.durationMs / 1000).toFixed(2)}s`}_`,
  ].join("\n");
}
