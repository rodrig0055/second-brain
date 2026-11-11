import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * The decisions the proposer makes before it touches a database.
 *
 * Mirrored here rather than imported: propose.ts is server-only and opens a
 * connection, and these are the rules worth arguing about.
 */
const PAUSE_KINDS = new Set([
  "cpa_multiple",
  "cir_over_target",
  "cost_per_warm",
  "lpvr_floor",
  "spend_min_conversions",
  "frequency_over",
]);

type Alert = {
  kind: string;
  confirmed: boolean;
  entityId: string;
  status: string;
  inMirror: boolean;
};

function wouldPropose(a: Alert, alreadyAsked: Set<string>): string | null {
  if (!a.confirmed) return "unconfirmed threshold";
  if (!PAUSE_KINDS.has(a.kind)) return "not a pause rule";
  if (alreadyAsked.has(a.entityId)) return "already waiting on a decision";
  if (!a.inMirror) return "not in the mirror yet";
  if (a.status !== "ACTIVE") return `already ${a.status.toLowerCase()}`;
  return null;
}

const ok: Alert = {
  kind: "cir_over_target",
  confirmed: true,
  entityId: "a1",
  status: "ACTIVE",
  inMirror: true,
};

test("a confirmed kill rule on a live entity is proposed", () => {
  assert.equal(wouldPropose(ok, new Set()), null);
});

test("an unconfirmed threshold never becomes a proposal", () => {
  // The seeded numbers are Acme Florals PH's. A proposal built on one is a
  // confident-sounding guess wearing another brand's name. The alert still
  // shows on the alerts tab, where it reads as the estimate it is.
  assert.equal(wouldPropose({ ...ok, confirmed: false }, new Set()), "unconfirmed threshold");
});

test("failed_to_run is not a pause rule", () => {
  // It means Meta is NOT spending on something already live. Pausing it would
  // be answering a delivery problem by stopping delivery.
  assert.equal(wouldPropose({ ...ok, kind: "failed_to_run" }, new Set()), "not a pause rule");
});

test("an entity already waiting on a decision is not asked about twice", () => {
  assert.equal(
    wouldPropose(ok, new Set(["a1"])),
    "already waiting on a decision",
  );
});

test("something a person already paused is left alone", () => {
  // The alert is about a window that has closed. The mirror says what is true
  // now, and proposing a pause for something paused is noise.
  assert.equal(wouldPropose({ ...ok, status: "PAUSED" }, new Set()), "already paused");
});

test("an entity the mirror has not seen is skipped, not guessed at", () => {
  assert.equal(wouldPropose({ ...ok, inMirror: false }, new Set()), "not in the mirror yet");
});

test("every kill rule proposes a pause, and nothing proposes a raise", () => {
  // The correct response to "this is losing money" is to stop it, not to guess
  // where the money should go instead. That needs different evidence.
  for (const kind of PAUSE_KINDS) {
    assert.equal(wouldPropose({ ...ok, kind }, new Set()), null, kind);
  }
  assert.equal(PAUSE_KINDS.has("set_budget"), false);
});
