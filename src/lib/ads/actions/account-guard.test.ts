import assert from "node:assert/strict";
import { test } from "node:test";

import { accountGate, type AccountClaim } from "./account-guard";

const BLOOMLY = "brand-bloomly";
const BULL = "brand-bull";
const ACME_FLORALS = "brand-acmeflorals";

/** The live shape as of 2026-09-24: Northwind Audio names Bloomly PH's account. */
const claims: AccountClaim[] = [
  { brandId: BLOOMLY, brandName: "Bloomly PH", adAccountId: "act_864562692946854" },
  { brandId: BULL, brandName: "Northwind Audio", adAccountId: "act_864562692946854" },
  {
    brandId: ACME_FLORALS,
    brandName: "Acme Florals",
    adAccountId: "act_2515313311013452",
  },
];

test("an account claimed by one brand passes", () => {
  assert.deepEqual(
    accountGate("act_2515313311013452", ACME_FLORALS, claims),
    { ok: true, reason: "" },
  );
});

test("a shared account is refused for both brands, not just the wrong one", () => {
  // The point. There is no way to tell which of the two is the mistake from
  // here, so neither may write until a person says.
  for (const brandId of [BLOOMLY, BULL]) {
    const verdict = accountGate("act_864562692946854", brandId, claims);
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /also claimed by/);
  }
  assert.match(
    accountGate("act_864562692946854", BLOOMLY, claims).reason,
    /Northwind Audio/,
  );
  assert.match(
    accountGate("act_864562692946854", BULL, claims).reason,
    /Bloomly PH/,
  );
});

test("the act_ prefix cannot be used to slip past the check", () => {
  // A guard a formatting difference walks through is not a guard. The bare and
  // prefixed forms are the same account and must collide.
  const mixed: AccountClaim[] = [
    { brandId: BLOOMLY, brandName: "Bloomly PH", adAccountId: "act_864562692946854" },
    { brandId: BULL, brandName: "Northwind Audio", adAccountId: "864562692946854" },
  ];
  assert.equal(accountGate("act_864562692946854", BLOOMLY, mixed).ok, false);
  assert.equal(accountGate("864562692946854", BLOOMLY, mixed).ok, false);
});

test("one brand with two connections to its own account is fine", () => {
  // Two rows, one brand. Nothing is ambiguous, so nothing is refused.
  const twice: AccountClaim[] = [
    { brandId: BLOOMLY, brandName: "Bloomly PH", adAccountId: "act_1" },
    { brandId: BLOOMLY, brandName: "Bloomly PH", adAccountId: "act_1" },
  ];
  assert.equal(accountGate("act_1", BLOOMLY, twice).ok, true);
});

test("a connection with no account id is refused rather than passed", () => {
  const verdict = accountGate("", BLOOMLY, claims);
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /no ad account id/);
});

test("the refusal names the fix, not just the problem", () => {
  // Whoever hits this is mid-task and needs to know where to go.
  const verdict = accountGate("act_864562692946854", BLOOMLY, claims);
  assert.match(verdict.reason, /Admin → Integrations/);
  assert.match(verdict.reason, /act_864562692946854/);
});

test("a third brand joining the collision is named too", () => {
  const three = [
    ...claims,
    { brandId: "brand-x", brandName: "Aloha", adAccountId: "act_864562692946854" },
  ];
  const reason = accountGate("act_864562692946854", BLOOMLY, three).reason;
  assert.match(reason, /Aloha and Northwind Audio/);
});
