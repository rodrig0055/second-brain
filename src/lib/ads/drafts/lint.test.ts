import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blocksRelease,
  dateMentions,
  lintAdCopy,
  saleTokens,
  type CopyDraft,
} from "./lint";

function draft(partial: Partial<CopyDraft> = {}): CopyDraft {
  return {
    headline: "Surprise them this Payday Sale?!",
    primaryText:
      "Dalian mo bago maubos! Madami kaming discount + Free same-day delivery!",
    purpose: "PAYDAY",
    ...partial,
  };
}

test("the real 8.8 caption in a 9.9 ad is caught, and blocks", () => {
  // Verbatim from the Ad Marketing Funnel sheet, PO26 tab. It went live.
  const findings = lintAdCopy(
    draft({
      headline: "Don't forget this 9.9 Mega Sale!",
      primaryText:
        "Don't forget the 8.8 Super Sale this August 8! Baka maubusan ka ng " +
        "gifts!!! Don't forget to surprise her. Get gifts for as low as ₱399 " +
        "+ Free Same-Day Delivery 🗓️💥",
      purpose: "9.9",
      eventDate: "2026-09-09",
    }),
  );
  const stale = findings.find((f) => f.message.includes("8.8"));
  assert.ok(stale, "the wrong sale name is reported");
  assert.equal(stale?.severity, "error");
  assert.match(stale!.message, /carried over from the last sale/);
  assert.equal(blocksRelease(findings), true);
});

test("the wrong date is caught separately from the wrong sale name", () => {
  const findings = lintAdCopy(
    draft({
      primaryText: "Order before August 8 to get free delivery!",
      purpose: "9.9",
      eventDate: "2026-09-09",
    }),
  );
  const wrongDate = findings.find((f) => f.message.includes("august 8"));
  assert.ok(wrongDate);
  assert.equal(wrongDate?.severity, "error");
});

test("copy naming its own sale is fine", () => {
  const findings = lintAdCopy(
    draft({
      headline: "Ready to Surprise this 9.9?",
      primaryText:
        "Save big this 9.9 and surprise your loved ones! Gifts for only ₱399 " +
        "and Free Same-Day Delivery.",
      purpose: "9.9",
      eventDate: "2026-09-09",
    }),
  );
  assert.equal(blocksRelease(findings), false);
});

test("prices and ratios are not mistaken for sale names", () => {
  // Both halves must match for a double-digit sale, so these are left alone.
  assert.deepEqual(saleTokens("2.5x ROAS on P1.5 spend at 9.15 today"), []);
  assert.deepEqual(saleTokens("Shop the 11.11 and 12.12 sales"), ["11.11", "12.12"]);
});

test("a headline past Meta's limit is an error, a short one only a warning", () => {
  const long = lintAdCopy(
    draft({ headline: "A".repeat(61) }),
  ).find((f) => f.field === "headline");
  assert.equal(long?.severity, "error");

  const short = lintAdCopy(draft({ headline: "Payday!" })).find(
    (f) => f.field === "headline",
  );
  assert.equal(short?.severity, "warn");
});

test("a headline inside the band draws no comment", () => {
  // 31 characters, inside 25-40.
  const findings = lintAdCopy(draft({ headline: "Surprise them this Payday Sale!" }));
  assert.equal(
    findings.filter((f) => f.field === "headline").length,
    0,
  );
});

test("an offer hidden past the fold is flagged", () => {
  const findings = lintAdCopy(
    draft({
      primaryText:
        "Nakakapagod din ang linggo minsan, at kung minsan kailangan mo lang " +
        "ng kaunting pahinga at oras para sa sarili mo bago ka bumalik ulit " +
        "sa trabaho na puno ng deadline. Get 30% off today!",
    }),
  );
  assert.ok(findings.some((f) => f.message.includes("See more")));
});

test("an offer stated up front is not flagged", () => {
  const findings = lintAdCopy(
    draft({
      primaryText:
        "Get 30% OFF and FREE same-day delivery this Payday! Gifts as low as " +
        "₱599 for the people who deserve them.",
    }),
  );
  assert.equal(findings.filter((f) => f.field === "primaryText").length, 0);
});

test("empty copy is an error on both fields", () => {
  const findings = lintAdCopy({ headline: "", primaryText: "" });
  assert.equal(findings.filter((f) => f.severity === "error").length, 2);
  assert.equal(blocksRelease(findings), true);
});

test("banned terms block", () => {
  const findings = lintAdCopy(draft({ primaryText: "Cheapest flowers guaranteed" }), {
    headlineMax: 60,
    headlineTargetMin: 25,
    headlineTargetMax: 40,
    primaryTextFold: 125,
    bannedTerms: ["cheapest"],
  });
  assert.ok(findings.some((f) => f.message.includes("banned term")));
  assert.equal(blocksRelease(findings), true);
});

test("a BAU ad may mention a sale without it being an error", () => {
  // Evergreen copy referencing a sale is a judgement call, not a defect.
  const findings = lintAdCopy(
    draft({ primaryText: "Bigger than our 11.11 sale.", purpose: "BAU" }),
  );
  assert.equal(blocksRelease(findings), false);
});

test("date mentions are normalised so formatting differences do not matter", () => {
  assert.deepEqual(dateMentions("this September 09 and SEPTEMBER 9"), [
    "september 9",
  ]);
});

test("a placeholder the writer left behind blocks release", () => {
  // Verbatim from the ad brief's own output when it was given no date: it
  // refuses to invent one, which is right, and leaves this to be filled in.
  const findings = lintAdCopy(
    draft({
      primaryText:
        "PAYDAY SALE [DATE]: Bouquets from ₱799 + FREE nationwide shipping. 💐",
    }),
  );
  assert.ok(findings.some((f) => f.message.includes("[DATE]")));
  assert.equal(blocksRelease(findings), true);
});

test("a bracketed aside in real copy is not mistaken for a placeholder", () => {
  const findings = lintAdCopy(
    draft({
      primaryText:
        "Send flowers today [order before 6pm for same-day delivery nationwide] 💐",
    }),
  );
  assert.equal(
    findings.filter((f) => f.message.includes("never filled in")).length,
    0,
  );
});
