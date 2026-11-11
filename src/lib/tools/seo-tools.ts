import { tool } from "ai";
import { z } from "zod";
import { runGscQuery } from "./bigquery-client";

/** Minimal shape we need from a brand row (see src/db/schema.ts). */
export type ToolBrand = { slug: string; name: string; domain: string };

const URL_TABLE = "searchdata_url_impression";

// Dimensions the model may group by, mapped to real columns. Identifiers can't
// be parameterized, so everything the model picks is validated against these.
const DIMENSIONS = {
  query: "query",
  page: "url",
  date: "data_date",
  country: "country",
  device: "device",
} as const;
type Dimension = keyof typeof DIMENSIONS;

type BrandTarget = { dataset: string; siteUrl: string };

/**
 * Resolves the BigQuery dataset + GSC property (`site_url`) for a brand from the
 * GSC_BQ_DATASETS env map. Value may be a bare dataset string (site_url is then
 * derived as `sc-domain:<domain>`) or an object `{ dataset, siteUrl }`.
 */
function resolveTarget(brand: ToolBrand): BrandTarget {
  const raw = process.env.GSC_BQ_DATASETS;
  if (!raw) {
    throw new Error("GSC_BQ_DATASETS is not set — no BigQuery dataset mapping for any brand.");
  }
  let map: Record<string, string | { dataset: string; siteUrl?: string }>;
  try {
    map = JSON.parse(raw);
  } catch {
    throw new Error("GSC_BQ_DATASETS is not valid JSON.");
  }
  const entry = map[brand.slug];
  if (!entry) {
    throw new Error(
      `No GSC dataset configured for brand "${brand.slug}". Add it to GSC_BQ_DATASETS.`,
    );
  }
  if (typeof entry === "string") {
    return { dataset: entry, siteUrl: `sc-domain:${brand.domain}` };
  }
  return { dataset: entry.dataset, siteUrl: entry.siteUrl ?? `sc-domain:${brand.domain}` };
}

/**
 * True when GSC_BQ_DATASETS maps this brand to a dataset — i.e. the GSC tools
 * are usable for it. Non-throwing, so callers can gate tool assembly on it.
 */
export function hasGscDataset(brand: Pick<ToolBrand, "slug">): boolean {
  const raw = process.env.GSC_BQ_DATASETS;
  if (!raw) return false;
  try {
    const map = JSON.parse(raw) as Record<string, unknown>;
    return map[brand.slug] != null;
  } catch {
    return false;
  }
}

function table(t: BrandTarget): string {
  // Backtick-quote dataset.table; the client already carries the project id.
  return `\`${t.dataset}.${URL_TABLE}\``;
}

const aggregates = `
  SUM(clicks) AS clicks,
  SUM(impressions) AS impressions,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
  SAFE_DIVIDE(SUM(sum_position), SUM(impressions)) + 1 AS position`;

/** Builds the tool set bound to a single brand so the model can't cross brands. */
export function buildSeoTools(brand: ToolBrand) {
  return {
    queryGsc: tool({
      description:
        "Query this brand's Google Search Console data (from the BigQuery bulk export) " +
        "for any date range. Group by one or more dimensions and filter by position, " +
        "impressions, or substring. Returns aggregated rows with clicks, impressions, " +
        "ctr, and average position. Use for cannibalization (group by query+page), " +
        "striking distance (maxPosition 20, minPosition 11), query clustering (group by " +
        "query), CTR analysis, etc. Dates are YYYY-MM-DD.",
      inputSchema: z.object({
        dimensions: z
          .array(z.enum(["query", "page", "date", "country", "device"]))
          .min(1)
          .describe("Columns to GROUP BY, e.g. ['query','page'] for cannibalization."),
        startDate: z.string().describe("Inclusive start date, YYYY-MM-DD."),
        endDate: z.string().describe("Inclusive end date, YYYY-MM-DD."),
        minImpressions: z.number().int().optional().describe("Keep groups with at least this many impressions."),
        minPosition: z.number().optional().describe("Keep groups with average position >= this (e.g. 11)."),
        maxPosition: z.number().optional().describe("Keep groups with average position <= this (e.g. 20)."),
        containsQuery: z.string().optional().describe("Only rows whose query contains this substring (case-insensitive)."),
        containsPage: z.string().optional().describe("Only rows whose URL contains this substring."),
        orderBy: z.enum(["clicks", "impressions", "ctr", "position"]).default("clicks"),
        orderDir: z.enum(["asc", "desc"]).default("desc"),
        limit: z.number().int().min(1).max(1000).default(200),
      }),
      execute: async (args) => {
        try {
          const t = resolveTarget(brand);
          const dims = args.dimensions as Dimension[];
          const selectDims = dims.map((d) => `${DIMENSIONS[d]} AS ${d}`).join(",\n  ");
          const groupBy = dims.map((_, i) => i + 1).join(", ");

          const params: Record<string, unknown> = {
            siteUrl: t.siteUrl,
            startDate: args.startDate,
            endDate: args.endDate,
          };
          const where = ["site_url = @siteUrl", "data_date BETWEEN @startDate AND @endDate"];
          if (args.containsQuery) {
            where.push("LOWER(query) LIKE CONCAT('%', LOWER(@containsQuery), '%')");
            params.containsQuery = args.containsQuery;
          }
          if (args.containsPage) {
            where.push("url LIKE CONCAT('%', @containsPage, '%')");
            params.containsPage = args.containsPage;
          }

          // HAVING references the SELECT aliases (impressions, position) rather
          // than re-wrapping the aggregates. Re-aggregating (e.g. SUM(impressions))
          // is read as SUM of the aggregate alias — "aggregations of aggregations".
          const having: string[] = [];
          if (args.minImpressions != null) {
            having.push("impressions >= @minImpressions");
            params.minImpressions = args.minImpressions;
          }
          if (args.minPosition != null) {
            having.push("position >= @minPosition");
            params.minPosition = args.minPosition;
          }
          if (args.maxPosition != null) {
            having.push("position <= @maxPosition");
            params.maxPosition = args.maxPosition;
          }

          const sql = `
SELECT
  ${selectDims},${aggregates}
FROM ${table(t)}
WHERE ${where.join("\n  AND ")}
GROUP BY ${groupBy}
${having.length ? `HAVING ${having.join("\n  AND ")}` : ""}
ORDER BY ${args.orderBy} ${args.orderDir.toUpperCase()}
LIMIT ${args.limit}`;

          const rows = await runGscQuery(sql, params, args.limit);
          return { siteUrl: t.siteUrl, rowCount: rows.length, rows };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    compareGscPeriods: tool({
      description:
        "Compare two date ranges for this brand and return per-group deltas (clicks, " +
        "impressions, ctr, position change) between a baseline period and a recent " +
        "period. Use for Decay Scanner, Weekly Report, and Ranking Anomaly Alerts. " +
        "Positive clicksDelta = growth; positive positionDelta = ranking got worse.",
      inputSchema: z.object({
        groupBy: z.enum(["page", "query"]).default("page"),
        baselineStart: z.string().describe("Baseline period start, YYYY-MM-DD."),
        baselineEnd: z.string().describe("Baseline period end, YYYY-MM-DD."),
        recentStart: z.string().describe("Recent period start, YYYY-MM-DD."),
        recentEnd: z.string().describe("Recent period end, YYYY-MM-DD."),
        minImpressions: z.number().int().default(50).describe("Min baseline impressions to include a group."),
        orderBy: z.enum(["clicksDelta", "impressionsDelta", "positionDelta"]).default("clicksDelta"),
        orderDir: z.enum(["asc", "desc"]).default("asc"),
        limit: z.number().int().min(1).max(1000).default(200),
      }),
      execute: async (args) => {
        try {
          const t = resolveTarget(brand);
          const col = args.groupBy === "page" ? "url" : "query";
          const params: Record<string, unknown> = {
            siteUrl: t.siteUrl,
            baselineStart: args.baselineStart,
            baselineEnd: args.baselineEnd,
            recentStart: args.recentStart,
            recentEnd: args.recentEnd,
            minImpressions: args.minImpressions,
          };
          const sql = `
WITH base AS (
  SELECT ${col} AS grp,
    SUM(clicks) AS clicks, SUM(impressions) AS impressions,
    SAFE_DIVIDE(SUM(sum_position), SUM(impressions)) + 1 AS position
  FROM ${table(t)}
  WHERE site_url = @siteUrl AND data_date BETWEEN @baselineStart AND @baselineEnd
  GROUP BY grp
  HAVING impressions >= @minImpressions
),
recent AS (
  SELECT ${col} AS grp,
    SUM(clicks) AS clicks, SUM(impressions) AS impressions,
    SAFE_DIVIDE(SUM(sum_position), SUM(impressions)) + 1 AS position
  FROM ${table(t)}
  WHERE site_url = @siteUrl AND data_date BETWEEN @recentStart AND @recentEnd
  GROUP BY grp
)
SELECT
  base.grp AS ${args.groupBy},
  base.clicks AS baselineClicks, IFNULL(recent.clicks, 0) AS recentClicks,
  IFNULL(recent.clicks, 0) - base.clicks AS clicksDelta,
  base.impressions AS baselineImpressions, IFNULL(recent.impressions, 0) AS recentImpressions,
  IFNULL(recent.impressions, 0) - base.impressions AS impressionsDelta,
  base.position AS baselinePosition, recent.position AS recentPosition,
  recent.position - base.position AS positionDelta
FROM base
LEFT JOIN recent ON base.grp = recent.grp
ORDER BY ${args.orderBy} ${args.orderDir.toUpperCase()}
LIMIT ${args.limit}`;

          const rows = await runGscQuery(sql, params, args.limit);
          return { siteUrl: t.siteUrl, rowCount: rows.length, rows };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    ahrefsRequest: tool({
      description:
        "Call the Ahrefs API v3 for keyword-idea generation and competitor/SERP data. " +
        "Pass Ahrefs query params in `params`; `select` is a comma list of columns and " +
        "`order_by` uses the 'column:desc' / 'column:asc' syntax (e.g. 'volume:desc').\n" +
        "Keyword ideas (for blog/content research — start here):\n" +
        "• 'keywords-explorer/overview' — metrics for exact seed keywords. Params: " +
        "keywords (comma list), country (e.g. 'ph'), select (keyword,volume,difficulty,cpc).\n" +
        "• 'keywords-explorer/matching-terms' — every keyword containing the seed(s); the " +
        "core idea generator. Params: keywords, country, select (keyword,volume,difficulty," +
        "cpc,parent_topic), order_by, limit, and optionally terms='questions' to get only " +
        "question queries (great for blog angles) or match_mode='terms'.\n" +
        "• 'keywords-explorer/related-terms' — semantically related topics. Params: keywords, " +
        "country, select, view_for ('top_10' or 'top_100'), order_by, limit.\n" +
        "Competitor/SERP (select AND date 'YYYY-MM-DD' are REQUIRED on all three; use yesterday):\n" +
        "• 'serp-overview/serp-overview' — the live top results for one keyword. Params: " +
        "keyword, country, date, select (position,url,title,domain_rating,traffic).\n" +
        "• 'site-explorer/organic-keywords' — what a domain or URL ranks for. Params: target " +
        "(domain, or a full URL with mode='exact'), country, date, select (keyword," +
        "best_position,volume,sum_traffic,best_position_url), order_by, limit. There is no " +
        "'position' or 'traffic' column; use best_position and sum_traffic.\n" +
        "• 'site-explorer/top-pages' — a domain's best pages. Params: target, country, date, " +
        "select (url,sum_traffic,keywords,top_keyword,top_keyword_best_position), " +
        "order_by 'sum_traffic:desc', limit. Returns the trimmed JSON response.",
      inputSchema: z.object({
        endpoint: z
          .enum([
            "keywords-explorer/overview",
            "keywords-explorer/matching-terms",
            "keywords-explorer/related-terms",
            "site-explorer/organic-keywords",
            "site-explorer/top-pages",
            "serp-overview/serp-overview",
          ])
          .describe("Ahrefs v3 endpoint path."),
        params: z
          .record(z.string(), z.union([z.string(), z.number()]))
          .describe(
            "Query params for the endpoint (keywords/target/keyword/country/date/select/" +
              "order_by/limit; matching-terms also takes terms and match_mode).",
          ),
      }),
      execute: async (args) => {
        const token = process.env.AHREFS_API_TOKEN;
        if (!token) return { error: "AHREFS_API_TOKEN is not set." };
        try {
          const qs = new URLSearchParams();
          for (const [k, v] of Object.entries(args.params)) qs.set(k, String(v));
          const url = `https://api.ahrefs.com/v3/${args.endpoint}?${qs.toString()}`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          });
          const body = await res.text();
          if (!res.ok) return { error: `Ahrefs ${res.status}: ${body.slice(0, 500)}` };
          const json = JSON.parse(body);
          // Trim large arrays so the result stays prompt-sized.
          if (json && Array.isArray(json.keywords)) json.keywords = json.keywords.slice(0, 100);
          if (json && Array.isArray(json.pages)) json.pages = json.pages.slice(0, 100);
          if (json && Array.isArray(json.positions)) json.positions = json.positions.slice(0, 100);
          return json;
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
