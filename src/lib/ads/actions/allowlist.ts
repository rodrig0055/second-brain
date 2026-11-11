/**
 * Which Graph fields a write is allowed to set, per resource and per action.
 *
 * The existing three action kinds set one field between them, `status`, from
 * code that names it literally. Managing budgets, schedules and bids means
 * writing fields chosen upstream rather than hard-coded, and at that point the
 * question "which fields may this touch" stops having an obvious answer.
 *
 * So it gets an explicit one. A field absent from these lists cannot be
 * written, whatever proposed it. That matters more here than in an ordinary
 * API client because the thing composing a proposal may be a language model,
 * and the failure it produces is not a crash but a plausible-looking field name
 * that Meta accepts and nobody intended.
 *
 * Pinned to Graph v26.0, the version `DEFAULT_API_VERSION` names. These are
 * deliberately NARROWER than what Meta accepts: this is what the brain may
 * propose, not what the API permits. Widening one is a decision, which is why
 * each list is short enough to read.
 *
 * Deliberately absent, and why:
 *
 *   targeting            a small edit has effects nobody can attribute for a
 *                        week, and there is no history yet of what targeting
 *                        produced what result. Phase 6 at the earliest.
 *   campaign objective   not editable after creation in any useful sense;
 *                        changing it resets learning.
 *   creative fields      a creative is immutable after creation. Changing an
 *                        ad means a new creative, which is the draft flow.
 *   special_ad_categories, targeting_automation
 *                        Housing, Employment and Credit/Finance rules. v26
 *                        requires targeting_automation.advantage_audience on
 *                        relaxable HEC-F ad sets, and gifting is none of those
 *                        categories. If that ever changes this needs a person
 *                        who knows the rules, not an allowlist entry.
 */

export type WriteResource = "campaign" | "adset" | "ad";
export type WriteAction = "create" | "update";

/**
 * Fields that may be set when creating.
 *
 * `status` is present so a create can be forced to PAUSED, which is checked
 * separately: being allowed to set it is not the same as being allowed to set
 * it to ACTIVE.
 */
const CREATE_FIELDS: Record<WriteResource, readonly string[]> = {
  campaign: [
    "name",
    "objective",
    "status",
    "special_ad_categories",
    "daily_budget",
    "lifetime_budget",
    "bid_strategy",
    "buying_type",
  ],
  adset: [
    "name",
    "campaign_id",
    "status",
    "daily_budget",
    "lifetime_budget",
    "billing_event",
    "optimization_goal",
    "bid_amount",
    "bid_strategy",
    "promoted_object",
    "targeting",
    "start_time",
    "end_time",
  ],
  ad: ["name", "adset_id", "creative", "status"],
};

/**
 * Fields that may be changed on something already live.
 *
 * Much shorter than the create list, because most of what defines an entity
 * should not be edited underneath a running campaign. Changing an ad set's
 * optimisation goal or billing event restarts learning and makes every number
 * before and after incomparable, so those are create-only.
 */
const UPDATE_FIELDS: Record<WriteResource, readonly string[]> = {
  campaign: ["name", "status", "daily_budget", "lifetime_budget", "bid_strategy"],
  adset: [
    "name",
    "status",
    "daily_budget",
    "lifetime_budget",
    "bid_amount",
    "start_time",
    "end_time",
  ],
  ad: ["name", "status"],
};

export function allowedFields(
  resource: WriteResource,
  action: WriteAction,
): readonly string[] {
  return action === "create" ? CREATE_FIELDS[resource] : UPDATE_FIELDS[resource];
}

export type FieldVerdict =
  | { ok: true }
  | { ok: false; reason: string; rejected: string[] };

/**
 * Whether every field in a proposed write is one this resource may set.
 *
 * Reports all the rejected names at once rather than the first: whoever is
 * looking at a refused proposal wants to know what to remove, not to discover
 * it one round trip at a time.
 */
export function checkFields(
  resource: WriteResource,
  action: WriteAction,
  fields: Record<string, unknown>,
): FieldVerdict {
  const names = Object.keys(fields);
  if (names.length === 0) {
    return {
      ok: false,
      reason: "A write has to change something.",
      rejected: [],
    };
  }

  const allowed = new Set(allowedFields(resource, action));
  const rejected = names.filter((name) => !allowed.has(name));
  if (rejected.length === 0) return { ok: true };

  const known = new Set([
    ...allowedFields(resource, "create"),
    ...allowedFields(resource, "update"),
  ]);
  // "Not on this action" and "not on this resource at all" are different
  // mistakes and lead to different fixes.
  const wrongAction = rejected.filter((name) => known.has(name));
  const unknown = rejected.filter((name) => !known.has(name));

  const parts: string[] = [];
  if (unknown.length > 0) {
    parts.push(
      `${unknown.join(", ")} cannot be set on a ${resource} by this app`,
    );
  }
  if (wrongAction.length > 0) {
    parts.push(
      `${wrongAction.join(", ")} can only be set when the ${resource} is created`,
    );
  }
  return { ok: false, reason: `${parts.join("; ")}.`, rejected };
}

/**
 * Whether a create is starting something delivering.
 *
 * Every campaign, ad set and ad is created paused so a person turns it on.
 * That has been true by convention inside `executeCreateAd`; here it is a rule
 * the request builder applies, which a future caller cannot skip by not
 * knowing about it.
 */
export function checkCreateStatus(
  fields: Record<string, unknown>,
): FieldVerdict {
  const status = fields.status;
  if (status === undefined) return { ok: true };
  if (status === "PAUSED") return { ok: true };
  return {
    ok: false,
    reason:
      `A new entity cannot start as ${String(status)}. Everything is created ` +
      "paused and switched on by a person; that is the whole safety model for " +
      "creation.",
    rejected: ["status"],
  };
}

/** The create payload, with PAUSED supplied rather than assumed. */
export function withForcedPause(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return { ...fields, status: "PAUSED" };
}
