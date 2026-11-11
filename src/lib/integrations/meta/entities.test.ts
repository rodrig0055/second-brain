import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fromMinorUnits,
  normalizeEntity,
  targetingFingerprint,
} from "./entities";

test("a two-decimal currency converts from minor units", () => {
  assert.equal(fromMinorUnits("1250", "USD"), 12.5);
  assert.equal(fromMinorUnits("1250", "PHP"), 12.5);
  assert.equal(fromMinorUnits(50000, "SGD"), 500);
});

test("a currency with no minor unit is already whole", () => {
  // The trap. Bloomly runs VN, and dividing by 100 would report every VND
  // budget as a hundredth of itself.
  assert.equal(fromMinorUnits("50000", "VND"), 50000);
  assert.equal(fromMinorUnits("50000", "vnd"), 50000);
  assert.equal(fromMinorUnits("1000", "JPY"), 1000);
});

test("an unset budget is null, not zero", () => {
  // Zero would read as "this ad set has no budget", which is a different and
  // alarming claim from "the budget is on the campaign".
  for (const empty of [null, undefined, ""]) {
    assert.equal(fromMinorUnits(empty, "USD"), null);
  }
  assert.equal(fromMinorUnits("not a number", "USD"), null);
  assert.equal(fromMinorUnits("0", "USD"), 0);
});

test("targeting hashes the same whatever order Meta serializes it in", () => {
  // Meta does not promise key order, so without this every sync would report
  // unchanged targeting as an edit.
  const a = { age_min: 25, geo_locations: { countries: ["PH"] }, age_max: 55 };
  const b = { age_max: 55, age_min: 25, geo_locations: { countries: ["PH"] } };
  assert.equal(targetingFingerprint(a), targetingFingerprint(b));
});

test("a real targeting change moves the hash", () => {
  const before = { age_min: 25, geo_locations: { countries: ["PH"] } };
  const after = { age_min: 30, geo_locations: { countries: ["PH"] } };
  assert.notEqual(targetingFingerprint(before), targetingFingerprint(after));
  // Array order is meaningful in a targeting spec and is not sorted away.
  assert.notEqual(
    targetingFingerprint({ countries: ["PH", "SG"] }),
    targetingFingerprint({ countries: ["SG", "PH"] }),
  );
});

test("no targeting hashes to empty rather than to a hash of null", () => {
  assert.equal(targetingFingerprint(null), "");
  assert.equal(targetingFingerprint(undefined), "");
});

test("an ad set's end_time is read as its stop time", () => {
  // Campaigns spell it stop_time and ad sets spell it end_time. Reading only
  // one leaves half the account with no schedule.
  const adset = normalizeEntity(
    { id: "1", end_time: "2026-10-01T00:00:00+0800" },
    "adset",
  );
  assert.ok(adset?.stopTime instanceof Date);
  const campaign = normalizeEntity(
    { id: "2", stop_time: "2026-10-01T00:00:00+0800" },
    "campaign",
  );
  assert.ok(campaign?.stopTime instanceof Date);
});

test("an entity is its own parent at its own level", () => {
  // So a campaign row can be found by campaignId without a special case.
  const campaign = normalizeEntity({ id: "c1" }, "campaign");
  assert.equal(campaign?.campaignId, "c1");
  const adset = normalizeEntity({ id: "a1", campaign_id: "c1" }, "adset");
  assert.equal(adset?.adSetId, "a1");
  assert.equal(adset?.campaignId, "c1");
});

test("budgets keep their minor-unit form on the way in", () => {
  // Stored as Meta sent them; conversion happens on read, where the currency
  // is known for certain.
  const row = normalizeEntity(
    { id: "1", daily_budget: "1250", lifetime_budget: 99900, bid_amount: "300" },
    "adset",
  );
  assert.equal(row?.dailyBudgetMinor, "1250");
  assert.equal(row?.lifetimeBudgetMinor, "99900");
  assert.equal(row?.bidAmountMinor, "300");
});

test("an entity with no id is dropped rather than stored keyless", () => {
  assert.equal(normalizeEntity({ name: "orphan" }, "ad"), null);
});

test("a malformed timestamp is null, not Invalid Date", () => {
  const row = normalizeEntity({ id: "1", created_time: "not a date" }, "ad");
  assert.equal(row?.metaCreatedAt, null);
});

test("each level asks the right edge for the right fields", async () => {
  const { FIELDS_BY_LEVEL, fetchEntities } = await import("./entities");
  const target = {
    accountId: "act_1",
    apiVersion: "v25.0",
    accessToken: "x",
  };
  const calls: { path: string; fields: string }[] = [];
  const fake = async (
    _t: typeof target,
    path: string,
    params: Record<string, string | number | undefined>,
  ) => {
    calls.push({ path, fields: String(params.fields) });
    return [{ id: "1", name: "row" }];
  };

  for (const level of ["campaign", "adset", "ad"] as const) {
    const { entities } = await fetchEntities(target, level, fake);
    assert.equal(entities.length, 1);
    assert.equal(entities[0].level, level);
  }

  assert.deepEqual(
    calls.map((c) => c.path),
    ["act_1/campaigns", "act_1/adsets", "act_1/ads"],
  );
  assert.equal(calls[0].fields, FIELDS_BY_LEVEL.campaign);
  assert.equal(calls[1].fields, FIELDS_BY_LEVEL.adset);
  // The ad-set list must ask for end_time, not stop_time, or every ad set
  // comes back with no schedule.
  assert.ok(calls[1].fields.includes("end_time"));
  assert.ok(!calls[1].fields.includes("stop_time"));
  assert.ok(calls[0].fields.includes("stop_time"));
  // Targeting is only on ad sets, and is what a proposal diffs against.
  assert.ok(calls[1].fields.includes("targeting"));
});

test("a Meta-shaped ad set survives the whole path", async () => {
  const { fetchEntities } = await import("./entities");
  const target = { accountId: "act_1", apiVersion: "v25.0", accessToken: "x" };
  const fake = async () => [
    {
      id: "23742002840665311",
      name: "TOF Testing - ABO",
      status: "ACTIVE",
      effective_status: "CAMPAIGN_PAUSED",
      campaign_id: "23357525224432244",
      daily_budget: "50000",
      budget_remaining: "12345",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      billing_event: "IMPRESSIONS",
      optimization_goal: "OFFSITE_CONVERSIONS",
      targeting: { geo_locations: { countries: ["PH"] }, age_min: 25 },
      promoted_object: { pixel_id: "123", custom_event_type: "PURCHASE" },
      end_time: "2026-10-01T00:00:00+0800",
      created_time: "2026-05-02T10:00:00+0800",
    },
  ];

  const { entities } = await fetchEntities(target, "adset", fake);
  const [row] = entities;
  assert.equal(row.entityId, "23742002840665311");
  assert.equal(row.campaignId, "23357525224432244");
  assert.equal(row.adSetId, "23742002840665311");
  assert.equal(row.dailyBudgetMinor, "50000");
  // USD 500.00, and the status a person set versus what Meta computes.
  assert.equal(fromMinorUnits(row.dailyBudgetMinor, "USD"), 500);
  assert.equal(row.status, "ACTIVE");
  assert.equal(row.effectiveStatus, "CAMPAIGN_PAUSED");
  assert.ok(row.targetingHash.length === 32);
  assert.equal(row.promotedObject?.custom_event_type, "PURCHASE");
  assert.ok(row.stopTime instanceof Date);
});

test("ads are not mirrored, because ad rows carry no configuration", async () => {
  // Measured across the three live accounts: of 11,710 ad rows, zero carried a
  // budget, targeting, an optimisation goal, a bid strategy or a schedule. All
  // five are campaign or ad-set fields. Filtering by status was tried first and
  // dropped nothing, since 10,372 of them are PAUSED rather than archived.
  const { syncedLevels } = await import("./entity-sync-levels");
  assert.deepEqual(syncedLevels(), ["campaign", "adset"]);
  assert.ok(!syncedLevels().includes("ad" as never));
});

test("hitting the page cap is reported, not hidden", async () => {
  // Exactly the ceiling means the walk ran out of pages, not entities. A
  // mirror quietly missing rows reads as confident to every check downstream.
  const { fetchEntities, PAGE_SIZE, MAX_PAGES } = await import("./entities");
  const target = { accountId: "act_1", apiVersion: "v26.0", accessToken: "x" };
  const full = Array.from({ length: PAGE_SIZE * MAX_PAGES }, (_, i) => ({
    id: String(i),
  }));

  const capped = await fetchEntities(target, "ad", async () => full);
  assert.equal(capped.truncated, true);

  const under = await fetchEntities(target, "ad", async () => full.slice(0, 5));
  assert.equal(under.truncated, false);
});
