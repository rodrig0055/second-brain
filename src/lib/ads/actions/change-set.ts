/**
 * Several changes proposed, approved and applied as one decision.
 *
 * Applying is deliberately not atomic and does not pretend to be. Meta has no
 * transaction spanning entities, so a set runs action by action and each keeps
 * its own outcome. `partial` is a real resting place rather than a failure:
 * some of it happened, and the row says which.
 *
 * The roll-up rule is the strict one. A set is `done` only when every action
 * is; anything else that finished is `partial`. Reporting a set as done because
 * most of it worked is how somebody concludes the budget moved when half of it
 * did.
 */
import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adActions, adChangeSets } from "@/db/schema";
import { executeAction, type ExecuteResult } from "./executor";
import { openKeyFor } from "./permissions";

/** Terminal states an action can reach, and what they mean for the set. */
const SUCCEEDED = new Set(["done"]);
const FINISHED = new Set([
  "done",
  "failed",
  "stale",
  "outcome_unknown",
  "cancelled",
]);

export type ChangeSetState =
  | "pending"
  | "approved"
  | "applying"
  | "done"
  | "partial"
  | "rejected"
  | "cancelled";

export type ChangeSetResult = {
  id: string;
  state: ChangeSetState;
  applied: number;
  failed: number;
  unknown: number;
  stale: number;
  results: ExecuteResult[];
};

/**
 * Roll individual outcomes up into the set's own state.
 *
 * Pure and exported so the rule can be read without following a query, because
 * it is the part that decides what a person is told happened.
 */
export function rollUp(states: string[]): ChangeSetState {
  if (states.length === 0) return "done";
  if (states.some((s) => !FINISHED.has(s))) return "applying";
  return states.every((s) => SUCCEEDED.has(s)) ? "done" : "partial";
}

/**
 * Apply every action in an approved set, in order.
 *
 * Sequential on purpose. These changes are usually related — money moved out of
 * one ad set and into another — and running them together would make a
 * half-applied set harder to read afterwards, not easier.
 *
 * Nothing is aborted early on a failure. The remaining actions were approved
 * too, each is independent at Meta, and stopping would leave a set half-applied
 * for a reason unrelated to the actions not yet tried.
 */
export async function applyChangeSet(setId: string): Promise<ChangeSetResult> {
  const set = await db.query.adChangeSets.findFirst({
    where: eq(adChangeSets.id, setId),
  });
  if (!set) {
    return {
      id: setId,
      state: "cancelled",
      applied: 0,
      failed: 0,
      unknown: 0,
      stale: 0,
      results: [],
    };
  }

  if (set.state !== "approved") {
    const rows = await db
      .select({ state: adActions.state })
      .from(adActions)
      .where(eq(adActions.changeSetId, setId));
    return {
      id: setId,
      state: set.state as ChangeSetState,
      applied: rows.filter((r) => r.state === "done").length,
      failed: rows.filter((r) => r.state === "failed").length,
      unknown: rows.filter((r) => r.state === "outcome_unknown").length,
      stale: rows.filter((r) => r.state === "stale").length,
      results: [],
    };
  }

  // Claimed the same way a single action is: a conditional update, so two runs
  // racing means one proceeds and the other finds nothing to do.
  const claimed = await db
    .update(adChangeSets)
    .set({ state: "applying", updatedAt: new Date() })
    .where(and(eq(adChangeSets.id, setId), eq(adChangeSets.state, "approved")))
    .returning({ id: adChangeSets.id });
  if (claimed.length === 0) {
    return {
      id: setId,
      state: "applying",
      applied: 0,
      failed: 0,
      unknown: 0,
      stale: 0,
      results: [],
    };
  }

  const actions = await db
    .select({ id: adActions.id })
    .from(adActions)
    .where(
      and(eq(adActions.changeSetId, setId), inArray(adActions.state, ["approved"])),
    );

  const results: ExecuteResult[] = [];
  for (const row of actions) {
    results.push(await executeAction(row.id));
  }

  const final = await db
    .select({ state: adActions.state })
    .from(adActions)
    .where(eq(adActions.changeSetId, setId));
  const states = final.map((r) => r.state);

  // Nothing moved. Every action was refused before it was claimed, which the
  // executor does when writes are switched off or the account is not
  // unambiguously this brand's. That is not a set in flight: it is a set still
  // waiting, and leaving it "applying" would strand it in a state no later run
  // would pick up.
  const untouched =
    actions.length > 0 && states.every((s) => s === "approved");
  const state = untouched ? "approved" : rollUp(states);

  await db
    .update(adChangeSets)
    .set({ state, updatedAt: new Date() })
    .where(eq(adChangeSets.id, setId));

  return {
    id: setId,
    state,
    applied: states.filter((s) => s === "done").length,
    failed: states.filter((s) => s === "failed").length,
    unknown: states.filter((s) => s === "outcome_unknown").length,
    stale: states.filter((s) => s === "stale").length,
    results,
  };
}

/**
 * Approve a set and everything in it, as one decision.
 *
 * The actions move with the set rather than being approved individually. The
 * whole point of a set is that six changes are one judgement, and leaving the
 * actions pending would let five of them be applied by a later sweep.
 */
export async function approveChangeSet(
  setId: string,
  userId: string,
  decision: string,
): Promise<void> {
  await db
    .update(adChangeSets)
    .set({
      state: "approved",
      decidedById: userId,
      decision,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(adChangeSets.id, setId), eq(adChangeSets.state, "pending")));

  const rows = await db
    .select({ id: adActions.id, kind: adActions.kind, entityId: adActions.entityId })
    .from(adActions)
    .where(and(eq(adActions.changeSetId, setId), eq(adActions.state, "pending")));

  for (const row of rows) {
    await db
      .update(adActions)
      .set({
        state: "approved",
        openKey: openKeyFor("approved", row.kind, row.entityId),
        decidedById: userId,
        decidedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(adActions.id, row.id));
  }
}

/** Reject a set, with the reason the next pass reads. */
export async function rejectChangeSet(
  setId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await db
    .update(adChangeSets)
    .set({
      state: "rejected",
      decidedById: userId,
      decision: reason,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(adChangeSets.id, setId), eq(adChangeSets.state, "pending")));

  await db
    .update(adActions)
    .set({ state: "rejected", openKey: null, decidedById: userId, decision: reason, updatedAt: new Date() })
    .where(and(eq(adActions.changeSetId, setId), eq(adActions.state, "pending")));
}
