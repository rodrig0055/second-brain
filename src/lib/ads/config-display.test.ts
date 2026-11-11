import assert from "node:assert/strict";
import { test } from "node:test";

import { fromMinorUnits } from "@/lib/integrations/meta/entities";

/**
 * What the drawer shows for a given stored row.
 *
 * The panel itself is a client component and cannot be signed into on this
 * machine, so the decisions it makes are pinned here instead: which fields are
 * hidden when empty, and what a budget in minor units becomes on screen.
 */

/** Mirrors ConfigPanel's rule: a field with no value is left out entirely. */
function shownFields(
  fields: [string, string | null][],
): [string, string][] {
  return fields.filter((f): f is [string, string] => Boolean(f[1]));
}

test("a field with no value is hidden rather than shown empty", () => {
  // An always-blank row reads as a missing value. It is not missing, it is
  // meaningless at this level: an ad has no objective.
  const shown = shownFields([
    ["Status", "Active"],
    ["Objective", null],
    ["Daily budget", null],
    ["Bid strategy", "Lowest Cost Without Cap"],
  ]);
  assert.deepEqual(shown.map(([label]) => label), ["Status", "Bid strategy"]);
});

test("a budget renders in the account currency, from minor units", () => {
  const usd = fromMinorUnits("50000", "USD");
  assert.equal(usd, 500);
  assert.equal(
    `${usd?.toLocaleString("en-US", { maximumFractionDigits: 2 })} USD`,
    "500 USD",
  );
  // And the currency where Meta's "minor unit" is already whole.
  assert.equal(fromMinorUnits("50000", "VND"), 50000);
});

test("a zero budget is treated as unset, because that is what Meta means by it", () => {
  // Corrected against real data: a live Bloomly PH ad set with a 5 USD daily
  // budget reports lifetime_budget as "0". An earlier version of this test
  // asserted zero was a deliberate setting and rendered "0 USD" in the drawer,
  // which showed an absence as a value somebody had chosen.
  const display = (v: number | null) => (v === null || v === 0 ? null : `${v} USD`);
  assert.equal(display(fromMinorUnits("0", "USD")), null);
  assert.equal(display(fromMinorUnits(null, "USD")), null);
  assert.equal(display(fromMinorUnits("500", "USD")), "5 USD");
  assert.equal(shownFields([["Lifetime budget", display(0)]]).length, 0);
});

test("delivery status is only shown when it differs from the set status", () => {
  // An ad set reading ACTIVE inside a paused campaign is the case worth
  // surfacing; ACTIVE/ACTIVE is noise.
  const differing = (status: string, effective: string) =>
    effective && effective !== status ? effective : null;
  assert.equal(differing("ACTIVE", "CAMPAIGN_PAUSED"), "CAMPAIGN_PAUSED");
  assert.equal(differing("ACTIVE", "ACTIVE"), null);
  assert.equal(differing("PAUSED", ""), null);
});
