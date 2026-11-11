// Friendly, present-tense labels for the agent's data tools, shown in the
// "current activity" line while a tool call is in flight (chat + task runs).
// Keys match the tool names registered in src/lib/tools/*.ts and
// src/lib/integrations/*/tools.ts. Anything unmapped falls back to a prettified
// version of the raw name.

const TOOL_LABELS: Record<string, string> = {
  queryGsc: "Searching Search Console",
  compareGscPeriods: "Comparing Search Console periods",
  ahrefsRequest: "Querying Ahrefs",
  ga4Overview: "Reading GA4",
  reviewScorecard: "Reading the marketing scorecard",
  ga4TopPages: "Reading GA4 pages",
  ga4TopProducts: "Reading GA4 products",
  ga4TrafficByChannel: "Reading GA4 channels",
  ga4Trend: "Reading GA4 trend",
  googleAdsCampaignPerformance: "Checking Google Ads",
  googleAdsSpend: "Checking Google Ads spend",
  googleAdsWastedSearchTerms: "Checking Google Ads search terms",
  metaCampaignPerformance: "Checking Meta Ads",
  metaCreativeFatigue: "Checking Meta creative fatigue",
  metaCreativeInsights: "Analyzing Meta creatives",
  metaSpend: "Checking Meta Ads spend",
  sendpulseCampaigns: "Checking SendPulse campaigns",
  sendpulseEmailSummary: "Checking SendPulse email",
  shopifyLiveToday: "Checking Shopify (today)",
  shopifySales: "Checking Shopify sales",
  metaEntities: "Listing Meta campaigns and ads",
  metaFunnelPerformance: "Reading Meta funnel performance",
  metaAlerts: "Reading Meta alerts",
  metaAnnotate: "Recording a Meta funnel decision",
  socialPlannedCalendar: "Reading the social calendar",
  present: "Laying out the answer",
};

export function humanizeToolName(name: string): string {
  const known = TOOL_LABELS[name];
  if (known) return known;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}
