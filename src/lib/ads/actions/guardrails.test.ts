import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_GUARDRAILS,
  checkGuardrails,
  describeImpact,
  type GuardrailContext,
  type ProposedChange,
} from "./guardrails";

/** USD: 100 minor units to the major one, and 500/day of trailing spend. */
const ctx: GuardrailContext = {
  trailingDailySpend: 500,
  currency: "USD",
  minorPerMajor: 100,
  now: new Date("2026-09-24T12:00:00Z"),
};

function budget(
  name: string,
  before: number,
  after: number,
  extra: Partial<ProposedChange> = {},
): ProposedChange {
  return {
    kind: "set_budget",
    level: "adset",
    entityId: name,
    entityName: name,
    beforeMinor: String(before * 100),
    afterMinor: String(after * 100),
    ...extra,
  };
}

test("moving money between ad sets nets to zero and passes", () => {
  // The case the whole batching idea exists for. Counting both legs as spend
  // would refuse the most ordinary proposal there is.
  const verdict = checkGuardrails(
    [budget("A", 100, 60), budget("B", 100, 140)],
    DEFAULT_GUARDRAILS,
    ctx,
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.netDailyDelta, 0);
  assert.equal(describeImpact(verdict, ctx), "No net change to daily spend.");
});

test("a net increase over the daily share is refused", () => {
  // 20% of 500 is 100. This adds 150.
  const verdict = checkGuardrails(
    [budget("A", 100, 200), budget("B", 100, 150)],
    DEFAULT_GUARDRAILS,
    ctx,
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.netDailyDelta, 150);
  assert.ok(verdict.breaches.some((b) => /raises daily spend by 150/.test(b)));
});

test("cuts are never capped by the daily share", () => {
  // A rule that blocked cuts would block exactly what the kill rules produce.
  const verdict = checkGuardrails(
    [budget("A", 400, 1), budget("B", 300, 1)],
    { ...DEFAULT_GUARDRAILS, maxEntityChangePct: 100 },
    ctx,
  );
  assert.equal(verdict.ok, true);
  assert.ok(verdict.netDailyDelta < 0);
  assert.match(describeImpact(verdict, ctx), /^cuts daily spend by/);
});

test("one entity moving too far is refused even when the net is fine", () => {
  // Net zero, but A more than halves. The per-entity cap is what stops a typo
  // hiding inside a balanced set.
  const verdict = checkGuardrails(
    [budget("A", 100, 10), budget("B", 100, 190)],
    DEFAULT_GUARDRAILS,
    ctx,
  );
  assert.equal(verdict.ok, false);
  assert.ok(verdict.breaches.some((b) => b.startsWith("A: 90%")));
});

test("every breach is reported, not the first", () => {
  const verdict = checkGuardrails(
    [budget("A", 100, 10), budget("B", 100, 5)],
    DEFAULT_GUARDRAILS,
    ctx,
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.breaches.length, 2);
});

test("a budget starting from zero is judged by the daily cap alone", () => {
  // A percentage of zero is not a percentage. Within the daily share it passes.
  const ok = checkGuardrails([budget("A", 0, 50)], DEFAULT_GUARDRAILS, ctx);
  assert.equal(ok.ok, true);
  // And over it, the daily cap still catches it.
  const over = checkGuardrails([budget("A", 0, 300)], DEFAULT_GUARDRAILS, ctx);
  assert.equal(over.ok, false);
  assert.ok(over.breaches.some((b) => /raises daily spend/.test(b)));
});

test("an increase with no trailing spend is refused rather than waved through", () => {
  const verdict = checkGuardrails([budget("A", 0, 10)], DEFAULT_GUARDRAILS, {
    ...ctx,
    trailingDailySpend: 0,
  });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.breaches.some((b) => /no trailing spend/.test(b)));
});

test("an entity somebody just touched is inside the cooldown", () => {
  const recent = budget("A", 100, 110, {
    lastChangedAt: new Date("2026-09-24T09:00:00Z"),
  });
  const verdict = checkGuardrails([recent], DEFAULT_GUARDRAILS, ctx);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.breaches.some((b) => /3.0h ago, inside the 12h cooldown/.test(b)));

  const old = budget("A", 100, 110, {
    lastChangedAt: new Date("2026-09-23T12:00:00Z"),
  });
  assert.equal(checkGuardrails([old], DEFAULT_GUARDRAILS, ctx).ok, true);
});

test("a set too large to read is refused on count alone", () => {
  const many = Array.from({ length: 21 }, (_, i) => budget(`A${i}`, 100, 100));
  const verdict = checkGuardrails(many, DEFAULT_GUARDRAILS, ctx);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.breaches.some((b) => /21 entities in one set/.test(b)));
});

test("an empty set is refused", () => {
  assert.equal(checkGuardrails([], DEFAULT_GUARDRAILS, ctx).ok, false);
});

test("status and schedule changes do not move the spend figure", () => {
  // Pausing changes spend in reality, but not by an amount this can compute,
  // and pretending otherwise would put a made-up number in front of an approver.
  const verdict = checkGuardrails(
    [
      { kind: "set_status", level: "adset", entityId: "A", entityName: "A" },
      { kind: "set_schedule", level: "adset", entityId: "B", entityName: "B" },
    ],
    DEFAULT_GUARDRAILS,
    ctx,
  );
  assert.equal(verdict.ok, true);
  assert.equal(verdict.netDailyDelta, 0);
});

test("a currency with no minor unit compares like for like", () => {
  // VND budgets arrive already whole. With minorPerMajor 1 the same numbers
  // mean what they say.
  const vnd: GuardrailContext = {
    trailingDailySpend: 5_000_000,
    currency: "VND",
    minorPerMajor: 1,
    now: ctx.now,
  };
  const change: ProposedChange = {
    kind: "set_budget",
    level: "adset",
    entityId: "A",
    entityName: "A",
    beforeMinor: "1000000",
    afterMinor: "1200000",
  };
  const verdict = checkGuardrails([change], DEFAULT_GUARDRAILS, vnd);
  assert.equal(verdict.netDailyDelta, 200_000);
  assert.equal(verdict.ok, true);
});
