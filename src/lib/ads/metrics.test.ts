import assert from "node:assert/strict";
import { test } from "node:test";

import {
  approximateReach,
  exactReach,
  EMPTY_COUNTERS,
  hasSignal,
  sumCounters,
  totalsOf,
  withRates,
  type AdCounters,
} from "./metrics";

/** A row with only the counters a case cares about spelled out. */
function row(partial: Partial<AdCounters>): AdCounters {
  return { ...EMPTY_COUNTERS, ...partial };
}

test("CIR matches the figure the specialist's sheet shows", () => {
  // Straight from the POPH tracker, Sep 13 2026 TOF: $23.00 spent against
  // $22.25 of conversion value reads as 103.37% — spending more than it earned.
  const totals = withRates(row({ spend: 23.0, purchaseValue: 22.25 }));
  assert.equal(totals.cir.toFixed(2), "103.37");
});

test("ROAS is CIR's reciprocal", () => {
  const totals = withRates(row({ spend: 23.0, purchaseValue: 22.25 }));
  assert.equal(totals.roas.toFixed(2), "0.97");
  assert.ok(Math.abs(totals.roas - 100 / totals.cir) < 1e-9);
});

test("rates come from the summed totals, not from averaging per-day rates", () => {
  // A $2 day at 400% CIR next to a $200 day at 50%. The real ratio is
  // 202/404 = 50.0%; averaging the two days' rates would report 225%.
  const days = [
    row({ spend: 2, purchaseValue: 0.5 }),
    row({ spend: 200, purchaseValue: 400 }),
  ];
  assert.equal(totalsOf(days).cir.toFixed(1), "50.4");
});

test("an empty denominator reads as zero, never NaN or Infinity", () => {
  const totals = withRates(row({ spend: 50 }));
  for (const value of Object.values(totals)) {
    assert.ok(Number.isFinite(value), "every metric stays finite");
  }
  assert.equal(totals.cir, 0);
  assert.equal(totals.cpp, 0);
});

test("outbound CTR and LPVr use outbound clicks, not all clicks", () => {
  // Meta's `clicks` counts likes and profile taps too. Reading CTR off it would
  // report 10% where the doc's outbound definition gives 2%.
  const totals = withRates(
    row({
      impressions: 10_000,
      clicksAll: 1_000,
      outboundClicks: 200,
      landingPageViews: 120,
    }),
  );
  assert.equal(totals.ctr, 2);
  assert.equal(totals.ctrAll, 10);
  assert.equal(totals.lpvr, 60);
});

test("warm is add to cart plus initiate checkout, and cost per warm follows it", () => {
  const totals = withRates(
    row({ spend: 36.7, addToCart: 6, initiateCheckout: 10 }),
  );
  assert.equal(totals.warm, 16);
  assert.equal(totals.costPerWarm.toFixed(4), (36.7 / 16).toFixed(4));
});

test("hook and hold rates use their own denominators", () => {
  const totals = withRates(
    row({ impressions: 10_000, videoViews3s: 2_500, thruPlays: 500 }),
  );
  assert.equal(totals.hookRate, 25);
  assert.equal(totals.holdRate, 20);
});

test("static creative reports zero video rates rather than dividing by zero", () => {
  const totals = withRates(row({ impressions: 10_000 }));
  assert.equal(totals.hookRate, 0);
  assert.equal(totals.holdRate, 0);
});

test("counters sum across rows and leave absent fields at zero", () => {
  const summed = sumCounters([
    { spend: 10, purchases: 1 },
    { spend: 5, purchases: 2 },
  ]);
  assert.equal(summed.spend, 15);
  assert.equal(summed.purchases, 3);
  assert.equal(summed.thruPlays, 0);
});

test("a whole week reconciles against the tracker's own daily rows", () => {
  // POPH Daily Tracker, TOTAL tab, Sep 7-13 2026 as displayed in the sheet.
  const week = [
    row({ spend: 29.49, impressions: 22_334, purchases: 0, purchaseValue: 0 }),
    row({ spend: 34.38, impressions: 24_574, purchases: 1, purchaseValue: 22.21 }),
    row({ spend: 38.63, impressions: 29_292, purchases: 4, purchaseValue: 77.24 }),
    row({ spend: 32.81, impressions: 24_989, purchases: 2, purchaseValue: 74.77 }),
    row({ spend: 32.96, impressions: 20_807, purchases: 1, purchaseValue: 19.05 }),
    row({ spend: 36.02, impressions: 24_135, purchases: 3, purchaseValue: 77.87 }),
    row({ spend: 36.7, impressions: 26_435, purchases: 1, purchaseValue: 22.25 }),
  ];
  const totals = totalsOf(week);
  assert.equal(totals.spend.toFixed(2), "240.99");
  assert.equal(totals.purchases, 12);
  assert.equal(totals.purchaseValue.toFixed(2), "293.39");
  // The week lands at 82% CIR — losing money, though four of the seven days
  // individually read under 50%. This is why rules read a window, not a day.
  assert.equal(totals.cir.toFixed(1), "82.1");
  assert.equal(totals.cpp.toFixed(2), "20.08");
});

test("reach is marked exact only when it came from the platform for that window", () => {
  const oneDay = exactReach(15_761, 26_435);
  assert.equal(oneDay.exact, true);
  assert.equal(oneDay.frequency.toFixed(2), "1.68");

  // Summing two days double-counts anyone reached on both, so the figure is an
  // upper bound and the frequency derived from it is understated.
  const summed = approximateReach([{ reach: 15_761 }, { reach: 15_440 }], 50_570);
  assert.equal(summed.exact, false);
  assert.equal(summed.reach, 31_201);
  assert.ok(summed.frequency < 2);
});

test("hasSignal refuses a rate whose denominator is empty", () => {
  const noPurchases = withRates(row({ spend: 45, impressions: 9_000 }));
  assert.equal(hasSignal(noPurchases, "cir"), false);
  assert.equal(hasSignal(noPurchases, "cpp"), false);
  assert.equal(hasSignal(noPurchases, "ctr"), true);
});

test("hasSignal enforces the minimums a rule asks for", () => {
  const thinDay = withRates(
    row({ spend: 3, impressions: 400, purchases: 1, purchaseValue: 22 }),
  );
  // The rate exists, but $3 is too little to pause an ad over.
  assert.equal(hasSignal(thinDay, "cir"), true);
  assert.equal(hasSignal(thinDay, "cir", { spend: 20 }), false);
  assert.equal(hasSignal(thinDay, "cir", { impressions: 1_000 }), false);
  assert.equal(hasSignal(thinDay, "cir", { spend: 1 }), true);
});
