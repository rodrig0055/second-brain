/**
 * The starting thresholds, transcribed from the performance marketing process
 * doc of 2026-07-08.
 *
 * These are Acme Florals PH's measured benchmarks. They are the only numbers
 * that exist: the doc has no Bloomly PH targets, and the Looker dashboard's CIR
 * guide disagrees with the doc in two places (it says MOF 30-40 and BOF 2-4
 * where the doc says MOF 20-30 and BOF 5-10). The doc wins here because it is
 * the document the team described as their process, but the disagreement is
 * the reason nothing seeded from this file counts as confirmed.
 *
 * Shared by the seed script and the rule checker so a preview and what
 * eventually gets stored cannot drift apart.
 */
import type { RuleKind, RuleLevel } from "./types";

export type DefaultRule = {
  key: string;
  kind: RuleKind;
  label: string;
  level: RuleLevel;
  funnels?: string[];
  includeEventAdSets?: boolean;
  params: Record<string, number>;
};

export const BENCHMARK_SOURCE =
  "Acme Florals PH benchmarks, performance marketing process doc 2026-07-08. " +
  "Not measured for this brand.";

/**
 * Minimum spend guards are about one day of each funnel's budget, so a rule
 * needs roughly a full day of delivery before it can pause anything. Bloomly PH
 * runs about $31 a day across six ad sets and a single day's CIR swings from
 * 44% to 173%, which is noise a threshold must not mistake for a verdict.
 */
export const DEFAULT_RULES: DefaultRule[] = [
  {
    key: "cpa-multiple",
    kind: "cpa_multiple",
    label: "Spent 3x the week's cost per purchase with nothing to show",
    level: "ad",
    params: { multiple: 3, maxPurchases: 0 },
  },
  {
    key: "cir-tof",
    kind: "cir_over_target",
    label: "TOF CIR over 50%",
    level: "ad",
    funnels: ["TOF"],
    params: { targetPct: 50, minSpend: 20 },
  },
  {
    key: "cir-mof",
    kind: "cir_over_target",
    label: "MOF CIR over 30%",
    level: "ad",
    funnels: ["MOF"],
    params: { targetPct: 30, minSpend: 7 },
  },
  {
    key: "cir-bof",
    kind: "cir_over_target",
    label: "BOF CIR over 10%",
    level: "ad",
    funnels: ["BOF"],
    params: { targetPct: 10, minSpend: 4 },
  },
  {
    key: "cost-per-warm",
    kind: "cost_per_warm",
    label: "Over $3 per add-to-cart or checkout (TOF and MOF)",
    level: "ad",
    funnels: ["TOF", "MOF"],
    params: { maxCostPerWarm: 3, minSpend: 15 },
  },
  {
    key: "lpvr-tof",
    kind: "lpvr_floor",
    label: "TOF landing page view rate under 40%",
    level: "ad",
    funnels: ["TOF"],
    params: { minLpvrPct: 40, minOutboundClicks: 50 },
  },
  {
    key: "lpvr-mof",
    kind: "lpvr_floor",
    label: "MOF landing page view rate under 50%",
    level: "ad",
    funnels: ["MOF"],
    params: { minLpvrPct: 50, minOutboundClicks: 50 },
  },
  {
    key: "lpvr-bof",
    kind: "lpvr_floor",
    label: "BOF landing page view rate under 60%",
    level: "ad",
    funnels: ["BOF"],
    params: { minLpvrPct: 60, minOutboundClicks: 30 },
  },
  {
    key: "frequency-tof",
    kind: "frequency_over",
    label: "TOF frequency over 2.5",
    level: "adset",
    funnels: ["TOF"],
    params: { maxFrequency: 2.5 },
  },
  {
    key: "frequency-mof",
    kind: "frequency_over",
    label: "MOF frequency over 3",
    level: "adset",
    funnels: ["MOF"],
    params: { maxFrequency: 3 },
  },
  {
    key: "frequency-bof",
    kind: "frequency_over",
    label: "BOF frequency over 5",
    level: "adset",
    funnels: ["BOF"],
    params: { maxFrequency: 5 },
  },
  {
    key: "spend-min-conversions",
    kind: "spend_min_conversions",
    label: "Past $30 with fewer than 3 purchases",
    level: "ad",
    params: { spend: 30, minPurchases: 3 },
  },
  {
    // The one rule that applies to event ad sets, because this is exactly where
    // that failure happens: new ads dropped in beside proven ones get no spend,
    // which the PO26 sheet records by hand as "FAILED TO RUN".
    key: "failed-to-run",
    kind: "failed_to_run",
    label: "Live for a day and Meta has not spent on it",
    level: "ad",
    includeEventAdSets: true,
    params: { hours: 24, maxSpend: 0 },
  },
];
