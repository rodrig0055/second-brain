import { test } from "node:test";
import assert from "node:assert/strict";
import { RULE_PARAMS, moneyFields, parseRuleParams } from "./params";
import { RULE_KINDS } from "./types";
import { DEFAULT_RULES } from "./defaults";

test("every rule kind has an editable parameter set", () => {
  for (const kind of RULE_KINDS) {
    assert.ok(RULE_PARAMS[kind]?.length, `${kind} has no params`);
    for (const field of RULE_PARAMS[kind]) {
      assert.ok(field.min < field.max, `${kind}.${field.key} has an empty range`);
      assert.ok(field.step > 0, `${kind}.${field.key} has no step`);
    }
  }
});

test("the shipped defaults are all inside their own editable ranges", () => {
  // If a default sits outside the range, the editor cannot show it without
  // immediately rejecting it, which would be worse than not shipping it.
  for (const rule of DEFAULT_RULES) {
    const fields = RULE_PARAMS[rule.kind];
    for (const [key, value] of Object.entries(rule.params as Record<string, number>)) {
      const field = fields.find((f) => f.key === key);
      assert.ok(field, `${rule.key} sets unknown param ${key}`);
      assert.ok(
        value >= field!.min && value <= field!.max,
        `${rule.key}.${key} = ${value} is outside ${field!.min}..${field!.max}`,
      );
    }
  }
});

test("parseRuleParams accepts a valid set and coerces strings", () => {
  const out = parseRuleParams("cir_over_target", { targetPct: "50", minSpend: "20" });
  assert.equal(out.ok, true);
  if (out.ok) assert.deepEqual(out.params, { targetPct: 50, minSpend: 20 });
});

test("parseRuleParams names the field that is wrong", () => {
  const out = parseRuleParams("cir_over_target", { targetPct: 9999, minSpend: 20 });
  assert.equal(out.ok, false);
  if (!out.ok) assert.match(out.error, /CIR target/);
});

test("parseRuleParams rejects a missing field rather than defaulting it", () => {
  const out = parseRuleParams("cir_over_target", { targetPct: 50 });
  assert.equal(out.ok, false);
});

test("money fields are identified so they can carry a currency", () => {
  assert.deepEqual(moneyFields("cir_over_target"), ["minSpend"]);
  assert.deepEqual(moneyFields("cost_per_warm"), ["maxCostPerWarm", "minSpend"]);
  // A multiple of the account's own CPA is not money in any currency.
  assert.deepEqual(moneyFields("cpa_multiple"), []);
});
