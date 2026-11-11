/**
 * The shapes the kill rules work with.
 *
 * Split from the evaluator so the database layer, the cockpit and the tests can
 * share them without importing anything that opens a connection.
 */
import type { AdTotals } from "../metrics";
import type { Funnel } from "../funnel";

export const RULE_KINDS = [
  /** Spent a multiple of the week's cost per purchase with little to show. */
  "cpa_multiple",
  /** CIR worse than the funnel's target. */
  "cir_over_target",
  /** TOF/MOF consideration is too expensive. */
  "cost_per_warm",
  /** Clicks are not turning into landing page views. */
  "lpvr_floor",
  /** The specialist's own: spend over X with fewer than N purchases. */
  "spend_min_conversions",
  /** Shown to the same people too often. */
  "frequency_over",
  /** Uploaded and live, but Meta is not spending on it. */
  "failed_to_run",
] as const;

export type RuleKind = (typeof RULE_KINDS)[number];

export type RuleLevel = "ad" | "adset" | "campaign";

export type Rule = {
  key: string;
  kind: RuleKind;
  enabled: boolean;
  /**
   * The currency the thresholds are written in.
   *
   * Carried per rule rather than assumed, because Bloomly PH bills in USD while
   * the .ph brands are otherwise talked about in pesos. A threshold of 30
   * means nothing until you know which. Evaluation refuses on a mismatch
   * rather than comparing the numbers anyway, which would be out by ~58x.
   */
  currency: string;
  level: RuleLevel;
  /** Empty means every funnel. */
  funnels?: Funnel[];
  /** Event ad sets are excluded by default: they exist to spend fast. */
  includeEventAdSets?: boolean;
  params: Record<string, number>;
  /**
   * Whether a human has confirmed these numbers for this brand.
   *
   * The seeded thresholds are Acme Florals PH's, taken from the process doc, and
   * no Bloomly PH targets exist yet. An unconfirmed rule still evaluates, but
   * says so everywhere it appears, so nobody reads a borrowed benchmark as this
   * brand's own.
   */
  confirmed: boolean;
};

/** One entity being judged, with its numbers already summed. */
export type RuleSubject = {
  level: RuleLevel;
  id: string;
  name: string;
  funnel: Funnel | null;
  isEventAdSet: boolean;
  /** Meta's configured status, not effective_status. */
  status: string;
  currency: string;
  /** Whole days since the entity started delivering. */
  daysActive: number;
  /** When it was created, for the failed-to-run check. */
  createdAt?: Date;
  /**
   * Totals over days Meta is no longer restating.
   *
   * Anything that judges purchases reads this. Meta credits a purchase to the
   * day of the click, so recent days keep gaining conversions for about a week
   * and an ad judged on them always looks worse than it is.
   */
  settled: AdTotals;
  /** Totals over the whole window, including days still moving. */
  live: AdTotals;
  /** Frequency for the window, and whether reach was exact (see metrics). */
  frequency?: { value: number; exact: boolean };
};

export type RuleSeverity = "critical" | "warning";

export type RuleFinding = {
  ruleKey: string;
  kind: RuleKind;
  severity: RuleSeverity;
  subject: Pick<RuleSubject, "level" | "id" | "name" | "funnel">;
  /** Which metric tripped, for the cockpit column. */
  metric: string;
  observed: number;
  threshold: number;
  /** Ready to show without rebuilding the sentence. */
  message: string;
  /** What the brain would propose. A human still approves it. */
  suggestedAction: "pause" | "review";
  /**
   * True when the finding rests on days Meta may still restate.
   *
   * Only the spend-based rules run this way, because the doc asks for them
   * early. Anyone reading a provisional finding needs to know a purchase could
   * still land against it.
   */
  provisional: boolean;
  /** Mirrors the rule, so borrowed benchmarks stay visible at the finding. */
  confirmed: boolean;
};

/** Account-level facts a rule needs beyond the entity in front of it. */
export type RuleContext = {
  /**
   * Cost per purchase over the trailing settled week, account-wide.
   *
   * The doc's "3X KPI" baseline. Null when the account had no purchases that
   * week, in which case the rule that depends on it is skipped rather than
   * compared against zero.
   */
  weeklyCpa: number | null;
  currency: string;
  now: Date;
};
