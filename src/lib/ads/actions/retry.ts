/**
 * What to do with a write to Meta that did not succeed.
 *
 * Pure, and its own module for the same reason `permissions.ts` is: it is a
 * rule, it is short, and it decides something expensive. Keeping it out of the
 * executor means it can be read and tested without a database.
 *
 * The distinction it exists to make is between a write that failed and a write
 * whose *reply* failed. Meta answering "no" means nothing was applied, so the
 * only question is whether asking again could get a different answer. A timeout
 * or a dropped connection answers nothing: Meta may have applied the change and
 * then lost the reply on the way back, so re-sending is how one approved ad
 * becomes two live ones.
 */
import { mutationOutcomeUnknown } from "@/lib/integrations/http";
import { MetaApiError } from "@/lib/integrations/meta/client";

/** How many times one action may be sent in total. */
export const MAX_ATTEMPTS = 3;

/**
 * Kinds whose write can be sent twice without doing anything twice.
 *
 * Setting a status is the whole list: asking for PAUSED on an ad that is
 * already paused changes nothing and returns success. Creation is absent by
 * definition, and anything added here later should have to argue for itself,
 * which is why this is a list of what is safe rather than a list of what is
 * not.
 */
const REPEATABLE_KINDS = new Set([
  "pause_ad",
  "activate_ad",
  // Setting a field to a value is the same operation however many times it is
  // sent: the second write finds what the first one left. Creation is the only
  // kind where repeating does something twice.
  "set_status",
  "set_budget",
  "set_schedule",
]);

/** What to do with a write that did not succeed. */
export type FailureRoute = "outcome_unknown" | "retry" | "failed";

/**
 * Where a failed write goes.
 *
 * `attempts` is the count *before* this one, matching the column as it read at
 * the moment the row was claimed.
 */
export function routeWriteFailure(
  err: unknown,
  opts: { actionKind: string; attempts: number },
): FailureRoute {
  const ambiguous = mutationOutcomeUnknown(err);
  const repeatable = REPEATABLE_KINDS.has(opts.actionKind);
  const attemptsLeft = opts.attempts + 1 < MAX_ATTEMPTS;

  // No reply came back. Repeating is only safe when repeating is a no-op, and
  // running out of attempts does not make the outcome any more known.
  if (ambiguous) {
    return repeatable && attemptsLeft ? "retry" : "outcome_unknown";
  }
  // Meta answered. Whatever it says, nothing was half-applied, so the only
  // question left is whether the same request could succeed later.
  const meta = err instanceof MetaApiError ? err : null;
  return meta?.retryable && attemptsLeft ? "retry" : "failed";
}
