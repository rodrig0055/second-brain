import { test } from "node:test";
import assert from "node:assert/strict";
import { brandMerchantAccount, ruleWithOverrideFirst, ruleWithoutOverride } from "./accounts";

const OURS = "accounts/1/dataSources/99";
const CSV = "accounts/1/dataSources/7";

test("puts the override first and keeps the existing rule in order", () => {
  const current = [{ supplementalDataSourceName: CSV }, { self: true }];
  assert.deepEqual(ruleWithOverrideFirst(current, OURS), [
    { supplementalDataSourceName: OURS },
    { supplementalDataSourceName: CSV },
    { self: true },
  ]);
});

test("an empty or missing rule means the feed only", () => {
  const expected = [{ supplementalDataSourceName: OURS }, { self: true }];
  assert.deepEqual(ruleWithOverrideFirst(undefined, OURS), expected);
  assert.deepEqual(ruleWithOverrideFirst([], OURS), expected);
});

test("is idempotent", () => {
  const once = ruleWithOverrideFirst([{ self: true }], OURS);
  assert.deepEqual(ruleWithOverrideFirst(once, OURS), once);
});

test("refuses a rule that would drop the feed itself", () => {
  assert.throws(() => ruleWithOverrideFirst([{ supplementalDataSourceName: CSV }], OURS));
  assert.throws(() => ruleWithoutOverride([{ supplementalDataSourceName: OURS }], OURS));
});

test("removing the override restores the original rule", () => {
  const original = [{ supplementalDataSourceName: CSV }, { self: true }];
  assert.deepEqual(ruleWithoutOverride(ruleWithOverrideFirst(original, OURS), OURS), original);
});

test("accounts are scoped to their brand", () => {
  process.env.MERCHANT_CENTER_ACCOUNTS = JSON.stringify({
    "bloomly-sg": [{ id: "5546402041", label: "Bloomly SG", live: true }],
  });
  assert.equal(brandMerchantAccount("bloomly-sg", "5546402041")?.label, "Bloomly SG");
  assert.equal(brandMerchantAccount("bloomly-ph", "5546402041"), null);
});
