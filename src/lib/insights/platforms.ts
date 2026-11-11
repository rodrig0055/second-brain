import { integrationPlatform } from "@/db/schema";

// The platform id is pinned to the DB enum so this registry can never drift from
// the schema. Adding a platform = add a row here (+ a sync adapter) — nothing in
// the Insights page changes.
export type InsightPlatformId = (typeof integrationPlatform.enumValues)[number];

// Which family a platform belongs to — drives how its section reads and what the
// empty state says. commerce/paid are live today; the rest are wired ahead of
// their adapters so they light up for free once data lands.
export type PlatformKind =
  | "commerce"
  | "paid"
  | "web-analytics"
  | "search"
  | "email";

export type MetricKey =
  | "revenue"
  | "spend"
  | "orders"
  | "conversions"
  | "impressions"
  | "clicks"
  | "sessions"
  | "emailsSent"
  | "opens";

export type InsightPlatform = {
  id: InsightPlatformId;
  label: string;
  glyph: string;
  kind: PlatformKind;
  /** Columns this platform meaningfully contributes — drives its KPI tiles. */
  metrics: MetricKey[];
  /** Folded into blended revenue (commerce + paid conversion value). */
  contributesRevenue: boolean;
  /** Folded into blended ad spend (paid platforms). */
  contributesSpend: boolean;
  /** Headline metric for the section's sparkline. */
  primaryMetric: MetricKey;
};

// Ordered for display: commerce first, then paid, then the rest.
export const INSIGHT_PLATFORMS: InsightPlatform[] = [
  {
    id: "shopify",
    label: "Shopify",
    glyph: "🛍",
    kind: "commerce",
    metrics: ["revenue", "orders"],
    contributesRevenue: true,
    contributesSpend: false,
    primaryMetric: "revenue",
  },
  {
    id: "meta",
    label: "Meta Ads",
    glyph: "◈",
    kind: "paid",
    metrics: ["spend", "revenue", "conversions", "impressions", "clicks"],
    contributesRevenue: true,
    contributesSpend: true,
    primaryMetric: "spend",
  },
  {
    id: "google_ads",
    label: "Google Ads",
    glyph: "◆",
    kind: "paid",
    metrics: ["spend", "revenue", "conversions", "impressions", "clicks"],
    contributesRevenue: true,
    contributesSpend: true,
    primaryMetric: "spend",
  },
  {
    id: "tiktok",
    label: "TikTok Ads",
    glyph: "♪",
    kind: "paid",
    metrics: ["spend", "revenue", "conversions", "impressions", "clicks"],
    contributesRevenue: true,
    contributesSpend: true,
    primaryMetric: "spend",
  },
  {
    id: "ga4",
    label: "Google Analytics",
    glyph: "▲",
    kind: "web-analytics",
    metrics: ["sessions", "conversions"],
    contributesRevenue: false,
    contributesSpend: false,
    primaryMetric: "sessions",
  },
  {
    id: "gsc",
    label: "Search Console",
    glyph: "⌕",
    kind: "search",
    metrics: ["clicks", "impressions"],
    contributesRevenue: false,
    contributesSpend: false,
    primaryMetric: "clicks",
  },
  {
    id: "sendpulse",
    label: "Email (SendPulse)",
    glyph: "✉",
    kind: "email",
    metrics: ["emailsSent", "opens"],
    contributesRevenue: false,
    contributesSpend: false,
    primaryMetric: "emailsSent",
  },
];

export const INSIGHT_PLATFORM_MAP = new Map(
  INSIGHT_PLATFORMS.map((p) => [p.id, p]),
);

/**
 * Which platforms to surface for a given brand. Shopify is Northwind Audio only —
 * every other brand runs a custom CMS, not Shopify — so it's hidden unless the
 * brand is on the northwindaudio domain, or it already has Shopify data/connection
 * (mirrors the admin Integrations rule in brand-connections.tsx).
 */
export function insightPlatformsForBrand(
  brandDomain: string,
  hasShopifyLink: boolean,
): InsightPlatform[] {
  return INSIGHT_PLATFORMS.filter((p) => {
    if (p.id === "shopify") {
      return brandDomain.includes("northwindaudio") || hasShopifyLink;
    }
    return true;
  });
}

// Human label for a metric key (KPI tiles, tooltips).
export const METRIC_LABELS: Record<MetricKey, string> = {
  revenue: "Revenue",
  spend: "Spend",
  orders: "Orders",
  conversions: "Conversions",
  impressions: "Impressions",
  clicks: "Clicks",
  sessions: "Sessions",
  emailsSent: "Emails sent",
  opens: "Opens",
};

/** True when the metric is a money column (formatted with currency). */
export const MONEY_METRICS: ReadonlySet<MetricKey> = new Set<MetricKey>([
  "revenue",
  "spend",
]);
