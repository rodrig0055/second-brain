import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canDecideAdAction,
  openKeyFor,
  validateRejection,
  type Actor,
  type DecidableAction,
} from "./permissions";

const ADS_TEAMS = ["meta-ads"];

function actor(partial: Partial<Actor> = {}): Actor {
  return {
    id: "u1",
    role: "member",
    brandIds: ["brand-bloomly"],
    teamSlugs: ["meta-ads"],
    ...partial,
  };
}

function action(partial: Partial<DecidableAction> = {}): DecidableAction {
  return {
    brandId: "brand-bloomly",
    state: "pending",
    proposedById: null,
    source: "rule",
    ...partial,
  };
}

test("an ads-team member with brand access may decide", () => {
  assert.deepEqual(canDecideAdAction(actor(), action(), ADS_TEAMS), {
    allowed: true,
  });
});

test("someone outside the ads team may not", () => {
  const outsider = actor({ teamSlugs: ["seo"] });
  const decision = canDecideAdAction(outsider, action(), ADS_TEAMS);
  assert.equal(decision.allowed, false);
});

test("an ads-team member without the brand may not", () => {
  // Team membership says nothing about whose budget you are trusted with.
  const wrongBrand = actor({ brandIds: ["brand-other"] });
  const decision = canDecideAdAction(wrongBrand, action(), ADS_TEAMS);
  assert.equal(decision.allowed, false);
  if (!decision.allowed) assert.match(decision.reason, /access to this brand/);
});

test("an admin may decide for any brand, matching the rest of the app", () => {
  const admin = actor({ role: "admin", brandIds: [], teamSlugs: [] });
  assert.equal(canDecideAdAction(admin, action(), ADS_TEAMS).allowed, true);
});

test("the specialist may approve what the agent proposed", () => {
  // The alternative is a team of one unable to act on anything the brain
  // suggests. Who proposed and who approved are both recorded.
  const decision = canDecideAdAction(
    actor(),
    action({ source: "agent", proposedById: "u1" }),
    ADS_TEAMS,
  );
  assert.equal(decision.allowed, true);
});

test("an action that is no longer pending cannot be decided again", () => {
  for (const state of ["approved", "done", "rejected", "stale"] as const) {
    const decision = canDecideAdAction(actor(), action({ state }), ADS_TEAMS);
    assert.equal(decision.allowed, false, state);
    if (!decision.allowed) assert.match(decision.reason, new RegExp(state));
  }
});

test("a rejection needs a reason worth reading", () => {
  assert.equal(validateRejection("").allowed, false);
  assert.equal(validateRejection("  ").allowed, false);
  assert.equal(validateRejection("no").allowed, false);
  assert.equal(validateRejection("still testing this creative").allowed, true);
});

test("an open action holds its entity, a closed one releases it", () => {
  // Unique while open, null once closed, so the same ad can be paused again
  // later but cannot collect two competing pending pauses now.
  assert.equal(openKeyFor("pending", "pause_ad", "120249"), "pause_ad:120249");
  assert.equal(openKeyFor("approved", "pause_ad", "120249"), "pause_ad:120249");
  assert.equal(openKeyFor("executing", "pause_ad", "120249"), "pause_ad:120249");
  for (const state of ["done", "rejected", "stale", "cancelled", "failed"] as const) {
    assert.equal(openKeyFor(state, "pause_ad", "120249"), null, state);
  }
});
