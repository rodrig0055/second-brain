/**
 * Who may approve a change to a live ad account.
 *
 * Pure, so it can be tested without a database and read without following a
 * query. The rule itself is deliberately simple, because a complicated one
 * would be argued with at the moment somebody needs to pause an ad.
 */

export type ActionState =
  | "pending"
  | "approved"
  | "executing"
  | "done"
  | "failed"
  | "rejected"
  | "stale"
  | "cancelled"
  /**
   * The write left and we never learned what happened to it.
   *
   * Distinct from `failed`, which means Meta refused and nothing changed. Here
   * the request may have been applied before the connection died, so the only
   * safe next step is for a person to look at the account. Kept as its own
   * state because the two call for opposite responses: a failure can be
   * retried, and this must not be.
   */
  | "outcome_unknown";

/** States from which a human decision is still meaningful. */
export const DECIDABLE_STATES: ActionState[] = ["pending"];

/** States the executor may claim. */
export const CLAIMABLE_STATES: ActionState[] = ["approved"];

/** Nothing further will happen to an action in one of these. */
export const TERMINAL_STATES: ActionState[] = [
  "done",
  "rejected",
  "stale",
  "cancelled",
  // Terminal for the executor, which will never touch it again. It still wants
  // a person's attention, and being terminal is what frees the entity's open
  // key so a fresh, deliberate action can be raised once they have looked.
  "outcome_unknown",
];

export type Actor = {
  id: string;
  role: "admin" | "member";
  /** Brands this person may see. */
  brandIds: string[];
  /** Team slugs this person belongs to. */
  teamSlugs: string[];
};

export type DecidableAction = {
  brandId: string;
  state: ActionState;
  proposedById: string | null;
  source: "rule" | "user" | "agent";
};

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Whether this person may approve or reject this action.
 *
 * Brand access is required rather than team membership alone: being on the ads
 * team says nothing about which brands' money someone is trusted with, and
 * pausing an ad is spending a brand's budget differently.
 *
 * Approving one's own agent-proposed action IS allowed. The alternative is a
 * team of one specialist unable to act on anything the brain suggests, which
 * would make the whole surface ornamental. The audit trail carries who
 * proposed and who approved, and they are allowed to be the same person.
 */
export function canDecideAdAction(
  actor: Actor,
  action: DecidableAction,
  adsTeamSlugs: readonly string[],
): Decision {
  if (!DECIDABLE_STATES.includes(action.state)) {
    return {
      allowed: false,
      reason: `This action is ${action.state}, so there is nothing left to decide.`,
    };
  }
  const onAdsTeam = actor.teamSlugs.some((slug) => adsTeamSlugs.includes(slug));
  if (!onAdsTeam && actor.role !== "admin") {
    return { allowed: false, reason: "Only the ads team can approve ad changes." };
  }
  // Admins reach every brand by design elsewhere in the app; mirror that here
  // rather than inventing a stricter rule that would surprise them.
  if (actor.role !== "admin" && !actor.brandIds.includes(action.brandId)) {
    return { allowed: false, reason: "You do not have access to this brand." };
  }
  return { allowed: true };
}

/**
 * Whether a rejection is properly recorded.
 *
 * A reason is required because the next pass reads past decisions: "no" with no
 * reason teaches nothing and the same proposal returns tomorrow. Mirrors the
 * proposals inbox, which requires a reason to dismiss for the same purpose.
 */
export function validateRejection(reason: string): Decision {
  const trimmed = reason.trim();
  if (trimmed.length < 3) {
    return {
      allowed: false,
      reason: "Say why. The reason is fed back into the next pass.",
    };
  }
  return { allowed: true };
}

/**
 * The key that keeps one entity from collecting competing open actions.
 *
 * Null once an action closes, so Postgres stops enforcing uniqueness on it and
 * the same ad can be paused again later.
 */
export function openKeyFor(
  state: ActionState,
  kind: string,
  entityId: string,
): string | null {
  if (TERMINAL_STATES.includes(state) || state === "failed") return null;
  return `${kind}:${entityId}`;
}
