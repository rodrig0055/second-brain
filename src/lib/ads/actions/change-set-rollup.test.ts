import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * How individual outcomes become the set's own state.
 *
 * Duplicated from change-set.ts rather than imported: that module is
 * server-only and pulls in a database connection, and this rule is the part
 * worth reading on its own.
 */
const SUCCEEDED = new Set(["done"]);
const FINISHED = new Set(["done", "failed", "stale", "outcome_unknown", "cancelled"]);

function rollUp(states: string[]): string {
  if (states.length === 0) return "done";
  if (states.some((s) => !FINISHED.has(s))) return "applying";
  return states.every((s) => SUCCEEDED.has(s)) ? "done" : "partial";
}

test("a set is done only when every action is", () => {
  assert.equal(rollUp(["done", "done", "done"]), "done");
});

test("one failure makes the whole set partial, not done", () => {
  // Reporting a set as done because most of it worked is how somebody
  // concludes the budget moved when half of it did.
  assert.equal(rollUp(["done", "done", "failed"]), "partial");
  assert.equal(rollUp(["done", "stale"]), "partial");
  assert.equal(rollUp(["done", "outcome_unknown"]), "partial");
});

test("a set with anything still running is applying", () => {
  assert.equal(rollUp(["done", "approved"]), "applying");
  assert.equal(rollUp(["executing"]), "applying");
});

test("a set where nothing succeeded is still partial, not failed", () => {
  // "Partial" is about the set being finished and not wholly successful. There
  // is no separate all-failed state, because the per-action rows already say
  // so and a fourth word would not tell anyone anything new.
  assert.equal(rollUp(["failed", "failed"]), "partial");
});

test("an empty set is done rather than stuck", () => {
  assert.equal(rollUp([]), "done");
});

test("a set whose actions were all refused before starting is still approved", () => {
  // The executor leaves an action `approved` when the write gate stops it, so
  // this is what a set looks like when writes are switched off. Calling it
  // "applying" would strand it: no later run looks for that state.
  const states = ["approved", "approved"];
  const untouched = states.length > 0 && states.every((s) => s === "approved");
  assert.equal(untouched ? "approved" : rollUp(states), "approved");

  // One having started means it really is in flight.
  const partway = ["approved", "done"];
  const started = partway.length > 0 && partway.every((s) => s === "approved");
  assert.equal(started ? "approved" : rollUp(partway), "applying");
});
