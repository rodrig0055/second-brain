import assert from "node:assert/strict";
import { test } from "node:test";

import { planStructure, type StructureBrief } from "./build-structure";

const model = {
  entityId: "23851",
  name: "TOF PO EXP BOX",
  targeting: { geo_locations: { countries: ["PH"] }, age_min: 18, age_max: 65 },
  optimizationGoal: "OFFSITE_CONVERSIONS",
  billingEvent: "IMPRESSIONS",
  promotedObject: { pixel_id: "123", custom_event_type: "PURCHASE" },
};

function brief(partial: Partial<StructureBrief> = {}): StructureBrief {
  return {
    name: "Q4 Corporate Gifting",
    objective: "OUTCOME_SALES",
    dailyBudgetMinor: "50000",
    budgetAt: "campaign",
    modelledOn: model,
    ...partial,
  };
}

test("a complete brief plans a paused campaign and ad set", () => {
  const plan = planStructure(brief());
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.campaign.status, "PAUSED");
  assert.equal(plan.adset.status, "PAUSED");
  assert.equal(plan.campaign.daily_budget, "50000");
  // With the budget on the campaign, the ad set carries none.
  assert.equal(plan.adset.daily_budget, undefined);
});

test("nothing can be planned into existence already delivering", () => {
  // The invariant the whole creation safety model rests on. withForcedPause
  // applies it, and checkCreateStatus is the second lock.
  const plan = planStructure(brief());
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  for (const req of [plan.campaign, plan.adset]) {
    assert.equal(req.status, "PAUSED");
  }
});

test("special_ad_categories is always sent, because Meta rejects the call without it", () => {
  const plan = planStructure(brief());
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.campaign.special_ad_categories, "[]");
});

test("the budget goes where the brief says, and only there", () => {
  const onAdset = planStructure(brief({ budgetAt: "adset" }));
  assert.equal(onAdset.ok, true);
  if (!onAdset.ok) return;
  assert.equal(onAdset.adset.daily_budget, "50000");
  assert.equal(onAdset.campaign.daily_budget, undefined);
});

test("targeting is copied from a real ad set, never invented", () => {
  // There is no history here of what targeting produced what result, so a
  // composed spec would be a guess with a confident face.
  const none = planStructure(brief({ modelledOn: null }));
  assert.equal(none.ok, false);
  if (none.ok) return;
  assert.match(none.reason, /model this on/);

  const unsynced = planStructure(
    brief({ modelledOn: { ...model, targeting: null } }),
  );
  assert.equal(unsynced.ok, false);
  if (unsynced.ok) return;
  assert.match(unsynced.reason, /no targeting stored/);
});

test("an objective this app does not create is refused by name", () => {
  const plan = planStructure(brief({ objective: "OUTCOME_APP_PROMOTION" }));
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.match(plan.reason, /not an objective this app creates/);
});

test("a campaign without a budget is refused", () => {
  for (const bad of ["0", "", "-100", "not a number"]) {
    const plan = planStructure(brief({ dailyBudgetMinor: bad }));
    assert.equal(plan.ok, false, `${bad} was accepted`);
  }
});

test("an unrecognisable name is refused, because somebody reads it later", () => {
  assert.equal(planStructure(brief({ name: "Q4" })).ok, false);
  assert.equal(planStructure(brief({ name: "   " })).ok, false);
});

test("the summary says what will exist, in sentences not field names", () => {
  const plan = planStructure(brief());
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.summary.length, 4);
  assert.ok(plan.summary.some((l) => /shares one pot/.test(l)));
  assert.ok(plan.summary.some((l) => /until a person turns it on/.test(l)));
  assert.ok(plan.summary.some((l) => /TOF PO EXP BOX/.test(l)));
});
