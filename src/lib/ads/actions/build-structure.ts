/**
 * Building a campaign and an ad set from a brief.
 *
 * The draft flow already turns a brief into an ad, but only into an ad set
 * that somebody made by hand in Ads Manager first. This is the two levels
 * above it, and it is the one part of the pipeline where getting it wrong
 * costs money rather than time: a campaign is not a proposal that can be
 * reconsidered, it is an object that exists afterwards.
 *
 * So creation is narrow on purpose.
 *
 * Everything starts PAUSED, enforced in the request builder rather than here,
 * so the worst outcome of a bug is an object nobody wanted that spends
 * nothing and is deleted in one click.
 *
 * Targeting is taken from an ad set that already works rather than composed.
 * The app has no history of what targeting produced what result, so inventing
 * a spec would be guessing with a confident face. Copying one the specialist
 * already chose is a decision they already made.
 *
 * A budget is required and checked against the same daily-delta guardrail as
 * any other change. A new campaign is new spend, and new spend is exactly what
 * that limit is for.
 */
import {
  checkCreateStatus,
  checkFields,
  withForcedPause,
} from "./allowlist";

/** The objectives this app will create. Narrower than Meta's list. */
const OBJECTIVES = [
  "OUTCOME_SALES",
  "OUTCOME_TRAFFIC",
  "OUTCOME_LEADS",
  "OUTCOME_AWARENESS",
  "OUTCOME_ENGAGEMENT",
] as const;
export type Objective = (typeof OBJECTIVES)[number];

export type StructureBrief = {
  name: string;
  objective: string;
  /** Minor units of the account currency. */
  dailyBudgetMinor: string;
  /** Where the budget sits. Campaign budget optimisation, or per ad set. */
  budgetAt: "campaign" | "adset";
  /** An existing ad set whose targeting and optimisation are copied. */
  modelledOn: {
    entityId: string;
    name: string;
    targeting: Record<string, unknown> | null;
    optimizationGoal: string;
    billingEvent: string;
    promotedObject: Record<string, unknown> | null;
  } | null;
};

export type BuildPlan =
  | {
      ok: true;
      campaign: Record<string, unknown>;
      adset: Record<string, unknown>;
      /** Plain sentences describing what will exist afterwards. */
      summary: string[];
    }
  | { ok: false; reason: string };

/**
 * Turn a brief into the two requests that would create it.
 *
 * Returns the requests rather than sending them: this is what a person
 * approves, and a plan they cannot read is a plan they cannot judge.
 */
export function planStructure(brief: StructureBrief): BuildPlan {
  const name = brief.name.trim();
  if (name.length < 3) {
    return { ok: false, reason: "Give it a name somebody will recognise later." };
  }
  if (!OBJECTIVES.includes(brief.objective as Objective)) {
    return {
      ok: false,
      reason:
        `${brief.objective} is not an objective this app creates. ` +
        `Use one of ${OBJECTIVES.join(", ")}.`,
    };
  }

  const budget = Number(brief.dailyBudgetMinor);
  if (!Number.isFinite(budget) || budget <= 0) {
    return { ok: false, reason: "A new campaign needs a daily budget." };
  }

  if (!brief.modelledOn) {
    return {
      ok: false,
      reason:
        "Pick an existing ad set to model this on. Targeting is copied from " +
        "something that already works rather than invented, because there is " +
        "no history here of what targeting produced what result.",
    };
  }
  if (!brief.modelledOn.targeting) {
    return {
      ok: false,
      reason:
        `${brief.modelledOn.name} has no targeting stored yet. Run a sync, or ` +
        "model this on a different ad set.",
    };
  }

  const campaign: Record<string, unknown> = withForcedPause({
    name,
    objective: brief.objective,
    // Meta requires this on every campaign create and rejects the call without
    // it. Empty is the correct value for gifting: the special categories are
    // housing, employment and credit.
    special_ad_categories: JSON.stringify([]),
    ...(brief.budgetAt === "campaign"
      ? { daily_budget: String(budget), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }
      : {}),
  });

  const adset: Record<string, unknown> = withForcedPause({
    name: `${name} - ad set`,
    optimization_goal: brief.modelledOn.optimizationGoal || "OFFSITE_CONVERSIONS",
    billing_event: brief.modelledOn.billingEvent || "IMPRESSIONS",
    targeting: JSON.stringify(brief.modelledOn.targeting),
    ...(brief.modelledOn.promotedObject
      ? { promoted_object: JSON.stringify(brief.modelledOn.promotedObject) }
      : {}),
    ...(brief.budgetAt === "adset"
      ? { daily_budget: String(budget), bid_strategy: "LOWEST_COST_WITHOUT_CAP" }
      : {}),
  });

  for (const [resource, fields] of [
    ["campaign", campaign],
    ["adset", adset],
  ] as const) {
    // campaign_id is filled in after the campaign exists, so it is exempt from
    // the check here rather than absent from the allowlist.
    const verdict = checkFields(resource, "create", fields);
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
    const status = checkCreateStatus(fields);
    if (!status.ok) return { ok: false, reason: status.reason };
  }

  return {
    ok: true,
    campaign,
    adset,
    summary: [
      `A campaign called "${name}", objective ${brief.objective}, paused.`,
      brief.budgetAt === "campaign"
        ? "The budget sits on the campaign, so every ad set under it shares one pot."
        : "The budget sits on the ad set, so each ad set is funded separately.",
      `One ad set, targeting copied from "${brief.modelledOn.name}".`,
      "Nothing delivers until a person turns it on, and it has no ads yet.",
    ],
  };
}
