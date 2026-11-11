import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allowedFields,
  checkCreateStatus,
  checkFields,
  withForcedPause,
} from "./allowlist";

test("a field nobody listed cannot be written", () => {
  // The case this exists for: something upstream composes a plausible field
  // name that Meta would accept and nobody intended.
  const verdict = checkFields("adset", "update", {
    daily_budget: "50000",
    frequency_control_specs: [{ event: "IMPRESSIONS", max_frequency: 2 }],
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual(verdict.rejected, ["frequency_control_specs"]);
  assert.match(verdict.reason, /cannot be set on a adset/);
});

test("a create-only field is refused on update, and says so", () => {
  // Changing an ad set's optimisation goal restarts learning and makes the
  // numbers either side incomparable, so it is create-only.
  const verdict = checkFields("adset", "update", {
    optimization_goal: "OFFSITE_CONVERSIONS",
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /only be set when the adset is created/);
  // And is accepted on the create it belongs to.
  assert.equal(
    checkFields("adset", "create", {
      name: "TOF",
      campaign_id: "1",
      optimization_goal: "OFFSITE_CONVERSIONS",
    }).ok,
    true,
  );
});

test("every rejected field is named at once", () => {
  const verdict = checkFields("campaign", "update", {
    name: "ok",
    objective: "OUTCOME_SALES",
    promoted_object: {},
    nonsense: 1,
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.rejected.length, 3);
  for (const name of ["objective", "promoted_object", "nonsense"]) {
    assert.ok(verdict.rejected.includes(name), `${name} not reported`);
  }
});

test("targeting cannot be edited on a live ad set", () => {
  // Deliberate: a small targeting edit has effects nobody can attribute for a
  // week, and there is no history yet of what targeting produced what result.
  assert.equal(checkFields("adset", "update", { targeting: {} }).ok, false);
  assert.ok(!allowedFields("adset", "update").includes("targeting"));
  // It is settable at creation, where there is nothing to disturb.
  assert.ok(allowedFields("adset", "create").includes("targeting"));
});

test("budget and schedule are editable, which is the point of the phase", () => {
  assert.equal(
    checkFields("adset", "update", {
      daily_budget: "50000",
      end_time: "2026-12-01T00:00:00+0800",
    }).ok,
    true,
  );
  assert.equal(
    checkFields("campaign", "update", { lifetime_budget: "990000" }).ok,
    true,
  );
});

test("an empty write is refused", () => {
  const verdict = checkFields("ad", "update", {});
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /has to change something/);
});

test("a create cannot start anything delivering", () => {
  assert.equal(checkCreateStatus({ name: "x" }).ok, true);
  assert.equal(checkCreateStatus({ status: "PAUSED" }).ok, true);
  for (const status of ["ACTIVE", "active", "ARCHIVED", true]) {
    const verdict = checkCreateStatus({ status });
    assert.equal(verdict.ok, false, `${String(status)} was allowed`);
    assert.match(verdict.reason, /created\s+paused/);
  }
});

test("the forced pause is applied rather than assumed", () => {
  // The invariant has to survive a caller that never mentions status, and one
  // that mentions it wrongly having already been refused above.
  assert.deepEqual(withForcedPause({ name: "x" }), { name: "x", status: "PAUSED" });
  assert.deepEqual(withForcedPause({ status: "PAUSED" }), { status: "PAUSED" });
});

test("no update list lets an entity be redefined underneath a campaign", () => {
  // A guard on the lists themselves: these are the fields that restart
  // learning or change what a number means, and none may be updated.
  const forbidden = [
    "objective",
    "optimization_goal",
    "billing_event",
    "targeting",
    "promoted_object",
    "campaign_id",
    "adset_id",
    "creative",
  ];
  for (const resource of ["campaign", "adset", "ad"] as const) {
    for (const field of allowedFields(resource, "update")) {
      assert.ok(
        !forbidden.includes(field),
        `${resource} update allows ${field}`,
      );
    }
  }
});

test("status is settable everywhere, because pausing is the main action", () => {
  for (const resource of ["campaign", "adset", "ad"] as const) {
    assert.ok(allowedFields(resource, "update").includes("status"));
  }
});
