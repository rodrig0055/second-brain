import { parseNumeric, type Block, type Cell, type Kpi, type TableColumn } from "./blocks";

/**
 * Turn a data tool's output into UI blocks, by code, so the figures the user
 * sees are exactly what the tool returned and never retyped by the model.
 *
 * Every data tool here returns the same kind of shape: a few top-line scalars
 * (spend, sessions, ROAS) and at most one list of rows (campaigns, days,
 * pages). That regularity is what lets one inferrer cover all of them instead
 * of a bespoke renderer per tool:
 *
 *   - top-level numbers and numeric strings  -> KPI tiles
 *   - the longest array of row objects        -> a sortable table
 *   - rows keyed by a YYYY-MM-DD `date`       -> also a line chart
 *   - `{ error }`                             -> a warning callout
 *
 * Tools whose output is prose or a write receipt (web fetch, skills, drafts)
 * are skipped, and so is any output the inferrer finds nothing in.
 */

export type ToolView = { title: string; subtitle?: string; blocks: Block[] };

/** Output is text for the model, or a write receipt: nothing to draw. */
const SKIP = new Set([
  "fetchWebPage",
  "searchWeb",
  "load_skill",
  "knowledge_read",
  "present",
  "metaAnnotate",
  "socialDraftPost",
]);

const TITLES: Record<string, string> = {
  queryGsc: "Search Console",
  compareGscPeriods: "Search Console, period comparison",
  ahrefsRequest: "Ahrefs",
  ga4Overview: "GA4 overview",
  ga4TopPages: "GA4 top landing pages",
  ga4TopProducts: "GA4 top products",
  ga4TrafficByChannel: "GA4 traffic by channel",
  ga4Trend: "GA4 daily trend",
  googleAdsSpend: "Google Ads spend",
  googleAdsCampaignPerformance: "Google Ads campaigns",
  googleAdsWastedSearchTerms: "Google Ads wasted search terms",
  metaSpend: "Meta Ads spend",
  metaCampaignPerformance: "Meta Ads campaigns",
  metaCreativeFatigue: "Meta creative fatigue",
  metaCreativeInsights: "Meta creative insights",
  metaEntities: "Meta campaigns and ads",
  metaFunnelPerformance: "Meta funnel performance",
  metaAlerts: "Meta alerts",
  shopifySales: "Shopify sales",
  shopifyLiveToday: "Shopify today",
  sendpulseCampaigns: "SendPulse campaigns",
  sendpulseEmailSummary: "SendPulse email summary",
  socialRecentPosts: "Recent social posts",
  socialTopPosts: "Top social posts",
  socialAudienceTrend: "Social audience trend",
  socialPendingDrafts: "Pending social drafts",
  storefrontProducts: "Storefront products",
  storefrontChanges: "Storefront changes",
  storefrontSitemapChanges: "Sitemap changes",
  storefrontSummary: "Storefront summary",
  merchantFindProducts: "Merchant Center products",
};

const ACRONYMS = new Set(["ctr", "cpa", "cpc", "cpm", "roas", "aov", "id", "url", "gsc"]);
const MONEY_KEY = /(spend|revenue|cpa|cpc|cpm|aov|cost|price|sales|budget|value)/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 500;
const MAX_KPIS = 8;
/** Metadata, not a metric: how many rows came back, which currency. */
const NOT_A_KPI = /^(currency|days|limit|offset|page|id)$|Id$/;

/** "purchaseRevenue" -> "Purchase revenue", "cpa" -> "CPA". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w));
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function toolTitle(name: string): string {
  return TITLES[name] ?? humanizeKey(name);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isMoney(key: string, currency: string | undefined): boolean {
  return !!currency && MONEY_KEY.test(key) && !/roas|count|rate/i.test(key);
}

function toKpi(key: string, v: unknown, currency: string | undefined): Kpi | null {
  if (NOT_A_KPI.test(key)) return null;
  const label = humanizeKey(key);
  if (typeof v === "number" && Number.isFinite(v)) {
    return { label, value: v, format: isMoney(key, currency) ? "money" : "number" };
  }
  if (typeof v === "string") {
    const n = parseNumeric(v);
    if (n === null) return null;
    // Percentages and ratios keep the tool's own formatting.
    if (v.includes("%") || /roas|rate/i.test(key)) return { label, value: v };
    return { label, value: n, format: isMoney(key, currency) ? "money" : "number" };
  }
  return null;
}

/** Identifiers look numeric but are labels: never sum, format or sort them as numbers. */
const isIdKey = (key: string) => key === "id" || /Id$/.test(key);

function toCell(v: unknown, key = ""): Cell {
  if (v === null || v === undefined) return null;
  if (isIdKey(key)) return typeof v === "string" || typeof v === "number" ? String(v) : null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") {
    // Plain numeric strings become numbers so they sort and format; "12.3%"
    // stays a string (the table still sorts it numerically).
    if (!v.includes("%")) {
      const n = parseNumeric(v);
      if (n !== null && !/^0\d/.test(v.trim())) return n;
    }
    return v;
  }
  if (Array.isArray(v)) {
    const flat = v.filter((x) => typeof x === "string" || typeof x === "number");
    return flat.length ? flat.join(", ") : null;
  }
  return null;
}

function tableFrom(
  rows: Record<string, unknown>[],
  currency: string | undefined,
): Extract<Block, { type: "table" }> | null {
  const sample = rows.slice(0, 50);
  const keys: string[] = [];
  for (const r of sample) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);

  const columns: TableColumn[] = [];
  for (const key of keys) {
    const values = sample.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
    if (values.length === 0) continue;
    // Nested objects have no single cell to show.
    if (values.every((v) => isRecord(v))) continue;
    const cells = values.map((v) => toCell(v, key)).filter((c) => c !== null);
    const numeric =
      !isIdKey(key) &&
      cells.length > 0 &&
      cells.every((c) => typeof c === "number" || (typeof c === "string" && parseNumeric(c) !== null));
    columns.push({
      key,
      label: humanizeKey(key),
      numeric,
      format: numeric ? (isMoney(key, currency) ? "money" : "number") : "text",
      hidden: isIdKey(key),
    });
  }
  if (columns.length === 0) return null;

  return {
    type: "table",
    columns,
    rows: rows
      .slice(0, MAX_ROWS)
      .map((r) => Object.fromEntries(columns.map((c) => [c.key, toCell(r[c.key], c.key)] as const))),
    currency,
  };
}

function chartFrom(
  table: Extract<Block, { type: "table" }>,
): Extract<Block, { type: "chart" }> | null {
  if (!table.columns.some((c) => c.key === "date")) return null;
  const dated = table.rows.filter((r) => typeof r.date === "string" && DATE.test(r.date));
  if (dated.length < 3 || dated.length !== table.rows.length) return null;
  const rows = [...dated].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const series = table.columns
    .filter((c) => c.numeric && !c.hidden && c.key !== "date")
    .filter((c) => rows.every((r) => typeof r[c.key] === "number"))
    .slice(0, 3)
    .map((c) => ({
      name: c.label,
      values: rows.map((r) => r[c.key] as number),
      format: c.format === "money" ? ("money" as const) : ("number" as const),
    }));
  if (series.length === 0) return null;
  return {
    type: "chart",
    kind: "line",
    labels: rows.map((r) => String(r.date)),
    series,
    currency: table.currency,
  };
}

export function toolView(name: string, input: unknown, output: unknown): ToolView | null {
  if (SKIP.has(name) || !isRecord(output)) return null;

  const title = toolTitle(name);
  const range =
    isRecord(input) && typeof input.startDate === "string" && typeof input.endDate === "string"
      ? input.startDate === input.endDate
        ? input.startDate
        : `${input.startDate} to ${input.endDate}`
      : undefined;

  if (typeof output.error === "string") {
    return {
      title,
      subtitle: range,
      blocks: [{ type: "callout", tone: "warn", text: `Could not load: ${output.error}` }],
    };
  }

  const currency = typeof output.currency === "string" ? output.currency : undefined;
  const blocks: Block[] = [];

  // The longest list is the main one. Others are usually a filtered subset of
  // it (wastedSpendCampaigns of campaigns), so drawing them would repeat rows.
  const lists = Object.values(output).filter(
    (v): v is Record<string, unknown>[] =>
      Array.isArray(v) && v.length > 0 && v.every(isRecord),
  );
  const main = lists.sort((a, b) => b.length - a.length)[0];

  const kpis = Object.entries(output)
    // "campaignCount: 3" above a 3-row table says nothing the table doesn't.
    .filter(([k]) => !(main && /Count$/.test(k)))
    .map(([k, v]) => toKpi(k, v, currency))
    .filter((k): k is Kpi => k !== null)
    .slice(0, MAX_KPIS);
  if (kpis.length) blocks.push({ type: "kpis", items: kpis, currency });

  if (main) {
    const table = tableFrom(main, currency);
    if (table) {
      const chart = chartFrom(table);
      if (chart) blocks.push(chart);
      blocks.push(table);
    }
  }

  return blocks.length ? { title, subtitle: range, blocks } : null;
}
