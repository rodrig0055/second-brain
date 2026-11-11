import { z } from "zod";
import type { RuleKind } from "./types";

/**
 * What each rule's numbers mean, so they can be edited safely.
 *
 * The thirteen rules shipped with Acme Florals PH's thresholds and no way to
 * change them, so every alert on every other account read "inherited from
 * Acme Florals PH, not measured here" forever. Editing them needs to know which
 * field is a percentage, which is money in the account's own currency, and what
 * a sane range is — hence this.
 */

export type ParamField = {
  key: string;
  label: string;
  hint?: string;
  /** Money is in the account's own currency. There is no FX in this app. */
  kind: "percent" | "money" | "count" | "multiple";
  min: number;
  max: number;
  step: number;
};

export const RULE_PARAMS: Record<RuleKind, ParamField[]> = {
  cpa_multiple: [
    {
      key: "multiple",
      label: "Multiple of the week's cost per purchase",
      hint: "3 means an ad that has spent three times what a purchase normally costs.",
      kind: "multiple",
      min: 1,
      max: 20,
      step: 0.5,
    },
    { key: "maxPurchases", label: "…while purchases are at most", kind: "count", min: 0, max: 20, step: 1 },
  ],
  cir_over_target: [
    { key: "targetPct", label: "CIR target", kind: "percent", min: 1, max: 200, step: 1 },
    {
      key: "minSpend",
      label: "Only once it has spent",
      hint: "Below this the ratio is too noisy to judge.",
      kind: "money",
      min: 0,
      max: 10_000,
      step: 1,
    },
  ],
  cost_per_warm: [
    { key: "maxCostPerWarm", label: "Most per add-to-cart or checkout", kind: "money", min: 0, max: 1000, step: 0.5 },
    { key: "minSpend", label: "Only once it has spent", kind: "money", min: 0, max: 10_000, step: 1 },
  ],
  lpvr_floor: [
    {
      key: "minLpvrPct",
      label: "Landing page views per outbound click, at least",
      hint: "Low means people click and leave before the page loads.",
      kind: "percent",
      min: 1,
      max: 100,
      step: 1,
    },
    { key: "minOutboundClicks", label: "Only after this many clicks", kind: "count", min: 0, max: 5000, step: 10 },
  ],
  spend_min_conversions: [
    { key: "spend", label: "Spent at least", kind: "money", min: 0, max: 10_000, step: 1 },
    {
      key: "minPurchases",
      label: "…with fewer than this many purchases",
      kind: "count",
      min: 0,
      max: 50,
      step: 1,
    },
  ],
  frequency_over: [
    {
      key: "maxFrequency",
      label: "Most times one person sees it",
      hint: "Above this the same audience is being shown the ad repeatedly.",
      kind: "multiple",
      min: 1,
      max: 20,
      step: 0.1,
    },
  ],
  failed_to_run: [
    {
      key: "hours",
      label: "Live for at least this many hours",
      hint: "An uploaded ad Meta has not spent on. Needs the creative status, which the nightly refresh keeps current.",
      kind: "count",
      min: 1,
      max: 168,
      step: 1,
    },
    { key: "maxSpend", label: "…having spent no more than", kind: "money", min: 0, max: 100, step: 0.5 },
  ],
};

/** Which fields are money, so the editor can label them with the currency. */
export function moneyFields(kind: RuleKind): string[] {
  return RULE_PARAMS[kind].filter((f) => f.kind === "money").map((f) => f.key);
}

/** Validate a submitted set of params for a rule kind. */
export function parseRuleParams(
  kind: RuleKind,
  input: Record<string, unknown>,
): { ok: true; params: Record<string, number> } | { ok: false; error: string } {
  const fields = RULE_PARAMS[kind];
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) shape[f.key] = z.coerce.number().min(f.min).max(f.max);

  const parsed = z.object(shape).safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = fields.find((f) => f.key === issue?.path[0]);
    return {
      ok: false,
      error: field
        ? `${field.label} must be between ${field.min} and ${field.max}.`
        : "Those thresholds are not valid.",
    };
  }
  return { ok: true, params: parsed.data as Record<string, number> };
}
