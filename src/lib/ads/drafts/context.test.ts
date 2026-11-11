import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_COUNTERS, withRates } from "../metrics";
import {
  pickLosers,
  pickWinners,
  spendFloor,
  summariseFunnels,
  type AdLike,
} from "./context";

function ad(
  name: string,
  counters: Partial<typeof EMPTY_COUNTERS>,
  funnel: string | null = "TOF",
): AdLike {
  return {
    id: name,
    name,
    funnel: funnel as AdLike["funnel"],
    totals: withRates({ ...EMPTY_COUNTERS, ...counters }),
    daysActive: 7,
    labelsOverridden: false,
  } as AdLike;
}

test("an ad that sold nothing is never suggested as a winner", () => {
  // CIR is spend / revenue, so no revenue divides by zero and reads as 0%,
  // which sorts ahead of every real result. The account's worst ad must not
  // be handed to the model as the one to copy.
  const rows = [
    ad("burned $80, sold nothing", { spend: 80 }),
    ad("sold well", { spend: 40, purchases: 4, purchaseValue: 160 }),
  ];
  const winners = pickWinners(rows, { minSpend: 10 });
  assert.equal(winners.length, 1);
  assert.equal(winners[0].name, "sold well");
});

test("winners are ordered by CIR, best first", () => {
  const rows = [
    ad("cir 50", { spend: 50, purchases: 2, purchaseValue: 100 }),
    ad("cir 25", { spend: 25, purchases: 2, purchaseValue: 100 }),
    ad("cir 80", { spend: 80, purchases: 2, purchaseValue: 100 }),
  ];
  assert.deepEqual(
    pickWinners(rows, { minSpend: 10 }).map((r) => r.name),
    ["cir 25", "cir 50", "cir 80"],
  );
});

test("an ad below the spend floor proves nothing either way", () => {
  const rows = [
    ad("lucky $3", { spend: 3, purchases: 1, purchaseValue: 90 }),
    ad("unlucky $4", { spend: 4 }),
  ];
  assert.deepEqual(pickWinners(rows, { minSpend: 20 }), []);
  assert.deepEqual(pickLosers(rows, { minSpend: 20 }), []);
});

test("losers lead with spend that bought nothing, biggest first", () => {
  const rows = [
    ad("dead small", { spend: 30 }),
    ad("dead big", { spend: 120 }),
    ad("cir 300", { spend: 60, purchases: 1, purchaseValue: 20 }),
    ad("cir 40", { spend: 40, purchases: 2, purchaseValue: 100 }),
  ];
  assert.deepEqual(
    pickLosers(rows, { minSpend: 10 }).map((r) => r.name),
    ["dead big", "dead small", "cir 300"],
  );
});

test("the spend floor scales with the account but never goes under $5", () => {
  assert.equal(spendFloor(0), 5);
  assert.equal(spendFloor(200), 5);
  assert.equal(spendFloor(4000), 40);
});

test("a funnel's CIR is the ratio of sums, not the average of the ads' CIRs", () => {
  // $2 at 10% and $200 at 200% average to 105%, which no money was spent at.
  const [tof] = summariseFunnels([
    ad("tiny winner", { spend: 2, purchases: 1, purchaseValue: 20 }),
    ad("big loser", { spend: 200, purchases: 1, purchaseValue: 100 }),
  ]);
  assert.equal(tof.spend, 202);
  assert.equal(Math.round(tof.cir), 168);
});

test("unmapped ads are left out of the funnel summary rather than guessed at", () => {
  const summaries = summariseFunnels([
    ad("mapped", { spend: 10, purchases: 1, purchaseValue: 40 }, "BOF"),
    ad("unmapped", { spend: 90, purchases: 1, purchaseValue: 40 }, null),
  ]);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].funnel, "BOF");
  assert.equal(summaries[0].spend, 10);
});
