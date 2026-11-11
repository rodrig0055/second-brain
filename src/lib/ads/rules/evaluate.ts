/**
 * The kill rules, as the process doc states them, made deterministic.
 *
 * No model is involved. These decide whether an ad is proposed for pausing, and
 * the reason has to be the same sentence every time, reproducible from stored
 * numbers and arguable with the specialist. A judgement that varies between
 * runs cannot be argued with, and would be the wrong tool for the job anyway.
 *
 * Two guards run before any rule, because Bloomly PH spends about $31 a day on 1
 * to 4 orders, so a single day's CIR swings between 44% and 173% on nothing but
 * which day a purchase landed:
 *
 *   attribution — anything judging purchases reads the settled window, never
 *   the last few days Meta is still writing conversions back into.
 *
 *   sample size — every rule carries a minimum spend or volume, so a $3 ad set
 *   is never paused for a rate computed from one click.
 */
import { hasSignal } from "../metrics";
import type {
  Rule,
  RuleContext,
  RuleFinding,
  RuleSubject,
} from "./types";

/** Money, in the subject's own currency. */
function money(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}

function pct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function applies(rule: Rule, subject: RuleSubject): boolean {
  if (!rule.enabled) return false;
  if (rule.level !== subject.level) return false;
  if (rule.funnels?.length) {
    if (!subject.funnel || !rule.funnels.includes(subject.funnel)) return false;
  }
  // Event ad sets are built to spend fast into a sale, so the everyday
  // efficiency rules would flag them by design. The doc: they exist because
  // Meta otherwise keeps spending on proven BAU ads and the new ones get
  // nothing. They are judged against their own targets, or not at all.
  if (subject.isEventAdSet && !rule.includeEventAdSets) return false;
  return true;
}

function base(
  rule: Rule,
  subject: RuleSubject,
): Omit<
  RuleFinding,
  "metric" | "observed" | "threshold" | "message" | "severity" | "provisional"
> {
  return {
    ruleKey: rule.key,
    kind: rule.kind,
    subject: {
      level: subject.level,
      id: subject.id,
      name: subject.name,
      funnel: subject.funnel,
    },
    suggestedAction: "pause",
    confirmed: rule.confirmed,
  };
}

/**
 * Spent a multiple of the week's cost per purchase without the purchases.
 *
 * The doc's first kill rule, and the one it explicitly wants early: "possible
 * that the ad had run for less than five days yet already spent 3X the expected
 * cost per purchase which is a signal to turn it off."
 *
 * So this one reads live spend, which never restates, against live purchases,
 * which do. That makes it the only rule that can fire on a number still moving,
 * and every finding it produces is marked provisional.
 */
function cpaMultiple(
  rule: Rule,
  subject: RuleSubject,
  ctx: RuleContext,
): RuleFinding | null {
  const multiple = rule.params.multiple ?? 3;
  const maxPurchases = rule.params.maxPurchases ?? 0;
  // No account-wide cost per purchase means no baseline. Comparing against
  // zero would flag every ad that has ever spent anything.
  if (ctx.weeklyCpa === null || ctx.weeklyCpa <= 0) return null;

  const threshold = multiple * ctx.weeklyCpa;
  if (subject.live.spend < threshold) return null;
  if (subject.live.purchases > maxPurchases) return null;

  const settledMatches = subject.settled.purchases <= maxPurchases;
  return {
    ...base(rule, subject),
    // Still provisional if the window includes days that can still gain a
    // purchase, but less alarming once the settled days agree.
    severity: settledMatches ? "critical" : "warning",
    provisional: !settledMatches,
    metric: "spend",
    observed: subject.live.spend,
    threshold,
    message:
      `Spent ${money(subject.live.spend, subject.currency)} with ` +
      `${subject.live.purchases} purchase${subject.live.purchases === 1 ? "" : "s"}, ` +
      `past ${multiple}x the week's ${money(ctx.weeklyCpa, ctx.currency)} cost per purchase` +
      (settledMatches
        ? "."
        : " — recent days may still gain conversions."),
  };
}

/** CIR worse than the funnel's target. */
function cirOverTarget(rule: Rule, subject: RuleSubject): RuleFinding | null {
  const target = rule.params.targetPct;
  const minSpend = rule.params.minSpend ?? 0;
  if (target === undefined) return null;
  if (!hasSignal(subject.settled, "cir", { spend: minSpend })) return null;
  if (subject.settled.cir <= target) return null;

  return {
    ...base(rule, subject),
    severity: subject.settled.cir > target * 2 ? "critical" : "warning",
    provisional: false,
    metric: "cir",
    observed: subject.settled.cir,
    threshold: target,
    message:
      `CIR ${pct(subject.settled.cir)} against a ${pct(target)} target, on ` +
      `${money(subject.settled.spend, subject.currency)} of settled spend.`,
  };
}

/** Consideration costs too much, the TOF and MOF signal the doc leans on. */
function costPerWarm(rule: Rule, subject: RuleSubject): RuleFinding | null {
  const max = rule.params.maxCostPerWarm;
  const minSpend = rule.params.minSpend ?? 0;
  if (max === undefined) return null;

  // No warm actions at all is a different finding from expensive ones, and the
  // rate would read 0 and look perfect. Fire on the spend instead.
  if (subject.settled.warm === 0) {
    if (subject.settled.spend < Math.max(minSpend, max)) return null;
    return {
      ...base(rule, subject),
      severity: "critical",
      provisional: false,
      metric: "costPerWarm",
      observed: Infinity,
      threshold: max,
      message:
        `No add to cart or checkout at all on ` +
        `${money(subject.settled.spend, subject.currency)} of settled spend.`,
    };
  }

  if (!hasSignal(subject.settled, "costPerWarm", { spend: minSpend })) return null;
  if (subject.settled.costPerWarm <= max) return null;

  return {
    ...base(rule, subject),
    severity: "warning",
    provisional: false,
    metric: "costPerWarm",
    observed: subject.settled.costPerWarm,
    threshold: max,
    message:
      `${money(subject.settled.costPerWarm, subject.currency)} per warm action ` +
      `against a ${money(max, rule.currency)} target.`,
  };
}

/**
 * Clicks that never become landing page views.
 *
 * The doc's reason for tracking it: it separates real traffic from accidental
 * clicks, so a healthy CTR with a poor LPVr means the clicks are not real.
 */
function lpvrFloor(rule: Rule, subject: RuleSubject): RuleFinding | null {
  const floor = rule.params.minLpvrPct;
  const minClicks = rule.params.minOutboundClicks ?? 0;
  if (floor === undefined) return null;
  if (subject.settled.outboundClicks < minClicks) return null;
  if (!hasSignal(subject.settled, "lpvr")) return null;
  if (subject.settled.lpvr >= floor) return null;

  return {
    ...base(rule, subject),
    severity: "warning",
    suggestedAction: "review",
    provisional: false,
    metric: "lpvr",
    observed: subject.settled.lpvr,
    threshold: floor,
    message:
      `Only ${pct(subject.settled.lpvr)} of ${subject.settled.outboundClicks} ` +
      `outbound clicks reached the page, against a ${pct(floor)} floor.`,
  };
}

/**
 * The specialist's own alert, stated in the doc as: "I set an ad to spend $30
 * with at least 3 conversions. I get alerted if that ad exceeds $30 with 0-2
 * conversions only upon open."
 */
function spendMinConversions(
  rule: Rule,
  subject: RuleSubject,
): RuleFinding | null {
  const spendLimit = rule.params.spend;
  const minPurchases = rule.params.minPurchases ?? 1;
  if (spendLimit === undefined) return null;
  if (subject.live.spend < spendLimit) return null;
  if (subject.live.purchases >= minPurchases) return null;

  const settledMatches = subject.settled.purchases < minPurchases;
  return {
    ...base(rule, subject),
    severity: settledMatches ? "critical" : "warning",
    provisional: !settledMatches,
    suggestedAction: "review",
    metric: "purchases",
    observed: subject.live.purchases,
    threshold: minPurchases,
    message:
      `Past ${money(spendLimit, rule.currency)} with ` +
      `${subject.live.purchases} of ${minPurchases} purchases` +
      (settledMatches ? "." : " — recent days may still gain conversions."),
  };
}

/** Shown to the same people too often. */
function frequencyOver(rule: Rule, subject: RuleSubject): RuleFinding | null {
  const max = rule.params.maxFrequency;
  if (max === undefined) return null;
  // Frequency divides by reach, and reach summed across days double-counts
  // anyone seen on more than one. An approximate figure understates frequency,
  // so acting on it would be acting on a number biased towards saying nothing.
  if (!subject.frequency?.exact) return null;
  if (subject.frequency.value <= max) return null;

  return {
    ...base(rule, subject),
    severity: "warning",
    suggestedAction: "review",
    provisional: false,
    metric: "frequency",
    observed: subject.frequency.value,
    threshold: max,
    message:
      `Frequency ${subject.frequency.value.toFixed(2)} against a ` +
      `${max.toFixed(2)} ceiling for this funnel.`,
  };
}

/**
 * Live, but Meta is not spending on it.
 *
 * The PO26 sheet records this by hand as "FAILED TO RUN", with notes like "used
 * old payday ads with $0 spend". It happens when new ads go into an ad set with
 * proven ones and Meta keeps buying the proven ones, which is the whole reason
 * event ad sets exist. Worth catching in hours, not at the end of a sale.
 */
function failedToRun(
  rule: Rule,
  subject: RuleSubject,
  ctx: RuleContext,
): RuleFinding | null {
  const hours = rule.params.hours ?? 24;
  const maxSpend = rule.params.maxSpend ?? 0;
  if (subject.status !== "ACTIVE") return null;
  if (!subject.createdAt) return null;

  const ageHours = (ctx.now.getTime() - subject.createdAt.getTime()) / 3_600_000;
  if (ageHours < hours) return null;
  if (subject.live.spend > maxSpend) return null;

  return {
    ...base(rule, subject),
    severity: "critical",
    provisional: false,
    suggestedAction: "review",
    metric: "spend",
    observed: subject.live.spend,
    threshold: maxSpend,
    message:
      `Active for ${Math.floor(ageHours)}h and has spent ` +
      `${money(subject.live.spend, subject.currency)}. Meta is not delivering ` +
      "it; it may need its own ad set.",
  };
}

const EVALUATORS: Record<
  Rule["kind"],
  (rule: Rule, subject: RuleSubject, ctx: RuleContext) => RuleFinding | null
> = {
  cpa_multiple: cpaMultiple,
  cir_over_target: (rule, subject) => cirOverTarget(rule, subject),
  cost_per_warm: (rule, subject) => costPerWarm(rule, subject),
  lpvr_floor: (rule, subject) => lpvrFloor(rule, subject),
  spend_min_conversions: (rule, subject) => spendMinConversions(rule, subject),
  frequency_over: (rule, subject) => frequencyOver(rule, subject),
  failed_to_run: failedToRun,
};

/**
 * Judge one entity against every rule.
 *
 * A currency mismatch throws rather than returning nothing: silently skipping
 * would look identical to "this ad is fine", and a misconfigured threshold
 * would then disable a rule without anyone noticing.
 */
export function evaluateSubject(
  rules: Rule[],
  subject: RuleSubject,
  ctx: RuleContext,
): RuleFinding[] {
  const findings: RuleFinding[] = [];
  for (const rule of rules) {
    if (!applies(rule, subject)) continue;
    if (rule.currency !== subject.currency) {
      throw new Error(
        `Rule "${rule.key}" is written in ${rule.currency} but ` +
          `${subject.level} ${subject.id} bills in ${subject.currency}. ` +
          "Set the rule's thresholds in the account's own currency.",
      );
    }
    const finding = EVALUATORS[rule.kind](rule, subject, ctx);
    if (finding) findings.push(finding);
  }
  // Worst first: the cockpit shows the top of this list and the digest counts it.
  return findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    if (a.provisional !== b.provisional) return a.provisional ? 1 : -1;
    return a.ruleKey.localeCompare(b.ruleKey);
  });
}

/** Judge many entities, keeping each one's findings together. */
export function evaluateAll(
  rules: Rule[],
  subjects: RuleSubject[],
  ctx: RuleContext,
): RuleFinding[] {
  return subjects.flatMap((subject) => evaluateSubject(rules, subject, ctx));
}
