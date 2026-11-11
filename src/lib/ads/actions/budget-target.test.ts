import assert from "node:assert/strict";
import { test } from "node:test";

import {
  affectsSiblings,
  resolveBudgetTarget,
  type BudgetHolder,
} from "./budget-target";

function holder(
  name: string,
  level: "campaign" | "adset",
  daily: string | null = null,
  lifetime: string | null = null,
): BudgetHolder {
  return {
    level,
    entityId: name,
    entityName: name,
    dailyBudgetMinor: daily,
    lifetimeBudgetMinor: lifetime,
  };
}

test("an ad set holding its own budget is written to directly", () => {
  const target = resolveBudgetTarget(
    holder("TOF Testing", "adset", "50000"),
    holder("Campaign", "campaign"),
  );
  assert.equal(target.ok, true);
  if (!target.ok) return;
  assert.equal(target.level, "adset");
  assert.equal(target.field, "daily_budget");
  assert.equal(target.currentMinor, "50000");
});

test("an ad set with no budget is written to its campaign", () => {
  // Campaign budget optimisation. Writing daily_budget to the ad set here is
  // accepted by Meta and changes nothing that spends, which is the failure
  // this resolver exists to prevent.
  const target = resolveBudgetTarget(
    holder("TOF Testing", "adset"),
    holder("CBO Campaign", "campaign", "150000"),
  );
  assert.equal(target.ok, true);
  if (!target.ok) return;
  assert.equal(target.level, "campaign");
  assert.equal(target.entityName, "CBO Campaign");
  assert.equal(target.currentMinor, "150000");
});

test("a lifetime budget is found when there is no daily one", () => {
  const target = resolveBudgetTarget(
    holder("Burst", "adset", null, "990000"),
    null,
  );
  assert.equal(target.ok, true);
  if (!target.ok) return;
  assert.equal(target.field, "lifetime_budget");
});

test("an unknown parent is refused, not assumed", () => {
  // "No budget on the ad set" and "no parent loaded" look the same from here
  // and mean different things. Guessing either way writes somewhere wrong.
  const target = resolveBudgetTarget(holder("Orphan", "adset"), null);
  assert.equal(target.ok, false);
  if (target.ok) return;
  assert.match(target.reason, /not in the mirror yet/);
});

test("a budget on neither is refused rather than invented", () => {
  const target = resolveBudgetTarget(
    holder("Ad set", "adset"),
    holder("Campaign", "campaign"),
  );
  assert.equal(target.ok, false);
  if (target.ok) return;
  assert.match(target.reason, /Neither ad set/);
});

test("zero and empty are treated as no budget, not as a budget of zero", () => {
  // Meta returns an absent budget in more than one shape, and a budget of zero
  // is not a thing an ad set spends from.
  for (const empty of ["0", "", null]) {
    const target = resolveBudgetTarget(
      holder("Ad set", "adset", empty),
      holder("Campaign", "campaign", "10000"),
    );
    assert.equal(target.ok, true);
    if (!target.ok) return;
    assert.equal(target.level, "campaign", `${String(empty)} read as a budget`);
  }
});

test("a shared campaign budget warns that siblings move too", () => {
  // "Cut this ad set to half" aimed at a campaign budget cuts all of them,
  // which is usually not what the sentence meant.
  const target = resolveBudgetTarget(
    holder("One of many", "adset"),
    holder("CBO Campaign", "campaign", "150000"),
  );
  const warning = affectsSiblings(target, 6);
  assert.ok(warning);
  assert.match(warning, /shared by 6 ad sets/);

  // A campaign with a single ad set has nothing to warn about.
  assert.equal(affectsSiblings(target, 1), null);
});

test("an ad-set budget never warns about siblings", () => {
  const target = resolveBudgetTarget(
    holder("Own budget", "adset", "50000"),
    holder("Campaign", "campaign"),
  );
  assert.equal(affectsSiblings(target, 9), null);
});
