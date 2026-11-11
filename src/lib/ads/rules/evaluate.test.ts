import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_COUNTERS, withRates, type AdCounters } from "../metrics";
import { evaluateSubject } from "./evaluate";
import type { Rule, RuleContext, RuleSubject } from "./types";

const NOW = new Date("2026-09-15T06:00:00Z");

function totals(partial: Partial<AdCounters>) {
  return withRates({ ...EMPTY_COUNTERS, ...partial });
}

function subject(partial: Partial<RuleSubject> = {}): RuleSubject {
  const settled = partial.settled ?? totals({});
  return {
    level: "ad",
    id: "124930224483736094",
    name: "Color Range",
    funnel: "TOF",
    isEventAdSet: false,
    status: "ACTIVE",
    currency: "USD",
    daysActive: 7,
    settled,
    live: partial.live ?? settled,
    ...partial,
  };
}

function rule(partial: Partial<Rule> & Pick<Rule, "kind">): Rule {
  return {
    key: partial.key ?? partial.kind,
    enabled: true,
    currency: "USD",
    level: "ad",
    params: {},
    confirmed: false,
    ...partial,
  };
}

const ctx: RuleContext = { weeklyCpa: 20.08, currency: "USD", now: NOW };

// --- the doc's 3x rule ---

test("3x the week's cost per purchase with no purchases is flagged", () => {
  // The week's CPA is 20.08, so 3x is 60.24.
  const findings = evaluateSubject(
    [rule({ kind: "cpa_multiple", params: { multiple: 3, maxPurchases: 0 } })],
    subject({ settled: totals({ spend: 65 }) }),
    ctx,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "critical");
  assert.equal(findings[0].provisional, false);
  assert.match(findings[0].message, /3x the week's USD 20\.08/);
});

test("the 3x rule is skipped when the account had no purchases to average", () => {
  // Comparing against a zero baseline would flag every ad that ever spent.
  const findings = evaluateSubject(
    [rule({ kind: "cpa_multiple", params: { multiple: 3 } })],
    subject({ settled: totals({ spend: 500 }) }),
    { ...ctx, weeklyCpa: null },
  );
  assert.deepEqual(findings, []);
});

test("a purchase inside the attribution lag downgrades the 3x finding", () => {
  // Live shows nothing yet, but a settled day already has a purchase, so the
  // number is still moving and the finding says so rather than claiming zero.
  const findings = evaluateSubject(
    [rule({ kind: "cpa_multiple", params: { multiple: 3, maxPurchases: 0 } })],
    subject({
      settled: totals({ spend: 40, purchases: 1 }),
      live: totals({ spend: 65, purchases: 0 }),
    }),
    ctx,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].provisional, true);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /may still gain conversions/);
});

test("an ad that already earned its purchases is left alone", () => {
  const findings = evaluateSubject(
    [rule({ kind: "cpa_multiple", params: { multiple: 3, maxPurchases: 0 } })],
    subject({ settled: totals({ spend: 65, purchases: 2 }) }),
    ctx,
  );
  assert.deepEqual(findings, []);
});

// --- CIR against target ---

test("CIR over the funnel target is flagged from settled days only", () => {
  const findings = evaluateSubject(
    [
      rule({
        kind: "cir_over_target",
        funnels: ["TOF"],
        params: { targetPct: 50, minSpend: 20 },
      }),
    ],
    subject({ settled: totals({ spend: 100, purchaseValue: 125 }) }),
    ctx,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].observed, 80);
  assert.equal(findings[0].provisional, false);
});

test("a thin ad set is not judged on its CIR", () => {
  // $3 of spend and one order swings CIR wildly; the minimum spend is what
  // stops a working ad being paused over a day's noise.
  const findings = evaluateSubject(
    [rule({ kind: "cir_over_target", params: { targetPct: 50, minSpend: 20 } })],
    subject({ settled: totals({ spend: 3, purchaseValue: 1 }) }),
    ctx,
  );
  assert.deepEqual(findings, []);
});

test("CIR far past target is critical rather than a warning", () => {
  const findings = evaluateSubject(
    [rule({ kind: "cir_over_target", params: { targetPct: 50, minSpend: 20 } })],
    subject({ settled: totals({ spend: 100, purchaseValue: 40 }) }),
    ctx,
  );
  assert.equal(findings[0].severity, "critical");
});

test("a rule only judges the funnels it is scoped to", () => {
  const tofOnly = rule({
    kind: "cir_over_target",
    funnels: ["TOF"],
    params: { targetPct: 50, minSpend: 1 },
  });
  const bofAd = subject({
    funnel: "BOF",
    settled: totals({ spend: 100, purchaseValue: 125 }),
  });
  assert.deepEqual(evaluateSubject([tofOnly], bofAd, ctx), []);
});

test("an unmapped entity is skipped by funnel-scoped rules", () => {
  const findings = evaluateSubject(
    [
      rule({
        kind: "cir_over_target",
        funnels: ["TOF", "MOF", "BOF"],
        params: { targetPct: 50, minSpend: 1 },
      }),
    ],
    subject({ funnel: null, settled: totals({ spend: 100, purchaseValue: 125 }) }),
    ctx,
  );
  assert.deepEqual(findings, []);
});

// --- warm and LPVr ---

test("no warm actions at all is flagged on spend, not on a rate", () => {
  // Cost per warm would divide by zero and read 0, which looks perfect.
  const findings = evaluateSubject(
    [rule({ kind: "cost_per_warm", params: { maxCostPerWarm: 3, minSpend: 10 } })],
    subject({ settled: totals({ spend: 40 }) }),
    ctx,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].observed, Infinity);
  assert.match(findings[0].message, /No add to cart or checkout at all/);
});

test("expensive warm actions are flagged against the target", () => {
  const findings = evaluateSubject(
    [rule({ kind: "cost_per_warm", params: { maxCostPerWarm: 3, minSpend: 10 } })],
    subject({ settled: totals({ spend: 40, addToCart: 3, initiateCheckout: 2 }) }),
    ctx,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].observed, 8);
});

test("a poor landing page view rate asks for review, not a pause", () => {
  const findings = evaluateSubject(
    [
      rule({
        kind: "lpvr_floor",
        params: { minLpvrPct: 40, minOutboundClicks: 50 },
      }),
    ],
    subject({
      settled: totals({ spend: 30, outboundClicks: 200, landingPageViews: 40 }),
    }),
    ctx,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].observed, 20);
  assert.equal(findings[0].suggestedAction, "review");
});

test("too few clicks to judge the landing page rate is left alone", () => {
  const findings = evaluateSubject(
    [
      rule({
        kind: "lpvr_floor",
        params: { minLpvrPct: 40, minOutboundClicks: 50 },
      }),
    ],
    subject({ settled: totals({ outboundClicks: 4, landingPageViews: 1 }) }),
    ctx,
  );
  assert.deepEqual(findings, []);
});

// --- the specialist's own alert ---

test("spend past the limit with too few purchases fires the custom alert", () => {
  // Their words: set an ad to $30 with at least 3 conversions, alert if it
  // passes $30 with 0 to 2.
  const findings = evaluateSubject(
    [
      rule({
        kind: "spend_min_conversions",
        params: { spend: 30, minPurchases: 3 },
      }),
    ],
    subject({ settled: totals({ spend: 31, purchases: 2 }) }),
    ctx,
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /2 of 3 purchases/);
});

test("the custom alert stays quiet once the purchases are there", () => {
  const findings = evaluateSubject(
    [
      rule({
        kind: "spend_min_conversions",
        params: { spend: 30, minPurchases: 3 },
      }),
    ],
    subject({ settled: totals({ spend: 45, purchases: 3 }) }),
    ctx,
  );
  assert.deepEqual(findings, []);
});

// --- frequency ---

test("frequency is only judged when reach was exact for the window", () => {
  const freqRule = rule({ kind: "frequency_over", params: { maxFrequency: 2.5 } });
  const approximate = subject({ frequency: { value: 4, exact: false } });
  assert.deepEqual(evaluateSubject([freqRule], approximate, ctx), []);

  const exact = subject({ frequency: { value: 4, exact: true } });
  assert.equal(evaluateSubject([freqRule], exact, ctx).length, 1);
});

// --- failed to run ---

test("an active ad that has not spent after a day is flagged", () => {
  const findings = evaluateSubject(
    [rule({ kind: "failed_to_run", params: { hours: 24, maxSpend: 0 } })],
    subject({
      createdAt: new Date("2026-09-13T06:00:00Z"),
      settled: totals({}),
    }),
    ctx,
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "critical");
  assert.match(findings[0].message, /may need its own ad set/);
});

test("a freshly uploaded ad is given its hours before being called failed", () => {
  const findings = evaluateSubject(
    [rule({ kind: "failed_to_run", params: { hours: 24, maxSpend: 0 } })],
    subject({ createdAt: new Date("2026-09-15T02:00:00Z") }),
    ctx,
  );
  assert.deepEqual(findings, []);
});

test("a paused ad is not expected to spend", () => {
  const findings = evaluateSubject(
    [rule({ kind: "failed_to_run", params: { hours: 24 } })],
    subject({
      status: "PAUSED",
      createdAt: new Date("2026-09-10T06:00:00Z"),
    }),
    ctx,
  );
  assert.deepEqual(findings, []);
});

// --- scope and safety ---

test("event ad sets are exempt unless a rule opts in", () => {
  const cir = rule({
    kind: "cir_over_target",
    level: "adset",
    params: { targetPct: 50, minSpend: 1 },
  });
  const forcePush = subject({
    level: "adset",
    id: "129525952285350302",
    name: "FORCE PUSH TOF",
    isEventAdSet: true,
    settled: totals({ spend: 100, purchaseValue: 125 }),
  });
  assert.deepEqual(evaluateSubject([cir], forcePush, ctx), []);
  assert.equal(
    evaluateSubject([{ ...cir, includeEventAdSets: true }], forcePush, ctx).length,
    1,
  );
});

test("a rule written in the wrong currency throws instead of passing silently", () => {
  // Skipping would be indistinguishable from "this ad is fine", and a
  // misconfigured threshold would disable the rule with nobody noticing. PHP
  // thresholds against a USD account are out by roughly 58x.
  assert.throws(
    () =>
      evaluateSubject(
        [rule({ kind: "cir_over_target", currency: "PHP", params: { targetPct: 50 } })],
        subject({ currency: "USD", settled: totals({ spend: 100, purchaseValue: 300 }) }),
        ctx,
      ),
    /written in PHP but ad .* bills in USD/,
  );
});

test("a disabled rule does nothing", () => {
  const findings = evaluateSubject(
    [
      rule({
        kind: "cir_over_target",
        enabled: false,
        params: { targetPct: 50, minSpend: 1 },
      }),
    ],
    subject({ settled: totals({ spend: 100, purchaseValue: 40 }) }),
    ctx,
  );
  assert.deepEqual(findings, []);
});

test("a rule for one level ignores the others", () => {
  const adSetRule = rule({
    kind: "cir_over_target",
    level: "adset",
    params: { targetPct: 50, minSpend: 1 },
  });
  const ad = subject({ settled: totals({ spend: 100, purchaseValue: 40 }) });
  assert.deepEqual(evaluateSubject([adSetRule], ad, ctx), []);
});

test("unconfirmed thresholds stay marked on every finding they produce", () => {
  // The seeded numbers are Acme Florals PH's; no Bloomly PH targets exist yet.
  const findings = evaluateSubject(
    [
      rule({
        kind: "cir_over_target",
        confirmed: false,
        params: { targetPct: 50, minSpend: 1 },
      }),
    ],
    subject({ settled: totals({ spend: 100, purchaseValue: 40 }) }),
    ctx,
  );
  assert.equal(findings[0].confirmed, false);
});

test("findings come back worst first", () => {
  const findings = evaluateSubject(
    [
      rule({
        key: "lpvr",
        kind: "lpvr_floor",
        params: { minLpvrPct: 40, minOutboundClicks: 10 },
      }),
      rule({
        key: "cir",
        kind: "cir_over_target",
        params: { targetPct: 50, minSpend: 1 },
      }),
    ],
    subject({
      settled: totals({
        spend: 100,
        purchaseValue: 40,
        outboundClicks: 200,
        landingPageViews: 20,
      }),
    }),
    ctx,
  );
  assert.equal(findings.length, 2);
  assert.equal(findings[0].severity, "critical");
  assert.equal(findings[0].kind, "cir_over_target");
});
