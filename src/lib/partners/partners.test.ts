import { test } from "node:test";
import assert from "node:assert/strict";

import { addWorkingDays, nextStep, urgency, type LadderTouch } from "./ladder";
import { periodOf, recentPeriods } from "./periods";
import { codeMatcher, parsePatterns } from "./codes";
import { kindOptions, resolveKind, statusAfterTouch } from "./model";

const email = (on: string, outcome: "sent" | "replied" = "sent"): LadderTouch => ({ channel: "email", outcome, on });
const call = (on: string, outcome: "sent" | "replied" = "sent"): LadderTouch => ({ channel: "call", outcome, on });

test("working days skip the weekend", () => {
  assert.equal(addWorkingDays("2026-10-23", 1), "2026-10-26"); // Fri -> Mon
  assert.equal(addWorkingDays("2026-10-19", 4), "2026-10-23"); // Mon -> Fri
  assert.equal(addWorkingDays("2026-10-24", 1), "2026-10-26"); // Sat -> Mon
});

test("the ladder climbs email, follow-up, call, call again", () => {
  assert.deepEqual(nextStep("prospect", []), { action: "Send the first email", due: null, rung: 0 });
  const one = nextStep("contacted", [email("2026-10-19")]);
  assert.equal(one?.rung, 1);
  assert.equal(one?.due, "2026-10-23");
  const two = nextStep("contacted", [email("2026-10-19"), email("2026-10-23")]);
  assert.equal(two?.rung, 2);
  assert.equal(two?.due, "2026-10-28");
  assert.equal(nextStep("contacted", [email("2026-10-19"), email("2026-10-23"), call("2026-10-28")])?.rung, 3);
  assert.equal(
    nextStep("contacted", [email("2026-10-19"), email("2026-10-23"), call("2026-10-28"), call("2026-11-02")])?.rung,
    4,
  );
});

test("a reply resets the ladder, and when they spoke last we owe the reply", () => {
  const replied = nextStep("talks", [email("2026-10-01"), email("2026-10-06", "replied")]);
  assert.equal(replied?.action, "Reply to them");
  assert.equal(replied?.due, "2026-10-07");
  // We answered and they went quiet: back to the first rung.
  const quiet = nextStep("talks", [email("2026-10-01"), call("2026-10-05"), email("2026-10-06", "replied"), email("2026-10-07")]);
  assert.equal(quiet?.rung, 1);
});

test("several emails on one day are one rung", () => {
  const same = nextStep("contacted", [email("2026-10-08"), email("2026-10-08"), email("2026-10-08")]);
  assert.equal(same?.rung, 1);
  assert.equal(nextStep("contacted", [email("2026-10-08"), email("2026-10-12")])?.rung, 2);
});

test("order of logging does not matter, only the dates", () => {
  const a = nextStep("contacted", [email("2026-10-23"), email("2026-10-19")]);
  assert.equal(a?.rung, 2);
});

test("a planned date overrides the ladder until a later contact", () => {
  const touches = [email("2026-10-01", "replied")];
  assert.equal(nextStep("talks", touches, "2026-12-01")?.due, "2026-12-01");
  assert.equal(nextStep("talks", touches, "2026-09-01")?.action, "Reply to them");
  assert.equal(nextStep("live", touches), null);
  assert.equal(nextStep("live", touches, "2026-11-15")?.action, "Planned check-in");
});

test("urgency against today", () => {
  assert.equal(urgency("2026-10-20", "2026-10-23"), "overdue");
  assert.equal(urgency("2026-10-23", "2026-10-23"), "today");
  assert.equal(urgency("2026-10-27", "2026-10-23"), "soon");
  assert.equal(urgency("2026-11-27", "2026-10-23"), "later");
  assert.equal(urgency(null, "2026-10-23"), "none");
});

test("logging a contact moves the status forward only", () => {
  assert.equal(statusAfterTouch("prospect", "sent"), "contacted");
  assert.equal(statusAfterTouch("prospect", "replied"), "talks");
  assert.equal(statusAfterTouch("contacted", "replied"), "talks");
  assert.equal(statusAfterTouch("talks", "sent"), "talks");
  assert.equal(statusAfterTouch("live", "replied"), "live");
});

test("half-months split on the 15th and always make a month", () => {
  assert.deepEqual(periodOf("2026-10-15", "half"), { key: "2026-10-1", start: "2026-10-01", end: "2026-10-15", label: "1-15 Oct" });
  assert.deepEqual(periodOf("2026-02-20", "half"), { key: "2026-02-2", start: "2026-02-16", end: "2026-02-28", label: "16-28 Feb" });
  assert.equal(periodOf("2026-10-23", "month").end, "2026-10-31");
  const six = recentPeriods("2026-10-23", "half", 6);
  assert.deepEqual(six.map((p) => p.key), ["2026-08-1", "2026-08-2", "2026-09-1", "2026-09-2", "2026-10-1", "2026-10-2"]);
  assert.deepEqual(recentPeriods("2026-01-05", "month", 2).map((p) => p.key), ["2025-12", "2026-01"]);
});

test("codes match the most specific partner pattern", () => {
  assert.deepEqual(parsePatterns(" kris*plus*, DIVEDEALS20\nkris*plus* "), ["KRIS*PLUS*", "DIVEDEALS20"]);
  const match = codeMatcher([
    { id: "kris", codes: ["KRIS*PLUS*"] },
    { id: "kris130", codes: ["KRIS130PLUS*"] },
    { id: "dive", codes: ["DIVEDEALS20"] },
  ]);
  assert.equal(match("KRIS50PLUS3WJP"), "kris");
  assert.equal(match("kris130plusjs44"), "kris130");
  assert.equal(match("DIVEDEALS20"), "dive");
  assert.equal(match("DIVEDEALS200"), undefined);
  assert.equal(match("WELCKAY3926055H"), undefined);
});

test("email draft helpers", async () => {
  const { defaultPurpose, gmailComposeUrl, senderName, stripDashes } = await import("./email");
  assert.equal(senderName({ name: "Admin", email: "sam@acmeflorals.example" }), "Sam");
  assert.equal(senderName({ name: "Alex Rivera", email: "alex@acmeflorals.example" }), "Alex");
  assert.equal(senderName({ name: null, email: "jordan@bloomly-sg.example" }), "Jordan");
  assert.equal(stripDashes("Bloomly SG — free delivery"), "Bloomly SG, free delivery");
  assert.equal(defaultPurpose({ status: "prospect", next: null, touchCount: 0 }), "first");
  assert.equal(defaultPurpose({ status: "talks", next: { action: "Reply to them", due: null, rung: null }, touchCount: 2 }), "reply");
  assert.equal(defaultPurpose({ status: "contacted", next: { action: "Call them", due: null, rung: 2 }, touchCount: 2 }), "follow_up");
  assert.equal(defaultPurpose({ status: "live", next: null, touchCount: 5 }), "check_in");
  const url = new URL(gmailComposeUrl({ to: "a@b.sg", subject: "Hi & bye", body: "Line 1\nLine 2", account: "me@x.ph" }));
  assert.equal(url.searchParams.get("su"), "Hi & bye");
  assert.equal(url.searchParams.get("body"), "Line 1\nLine 2");
  assert.equal(url.searchParams.get("authuser"), "me@x.ph");
});

test("resolveKind matches built-ins and existing types, else keeps the typed name", () => {
  assert.equal(resolveKind("  ", []), "");
  assert.equal(resolveKind("media", []), "media");
  assert.equal(resolveKind("Perks Platform", []), "platform");
  assert.equal(resolveKind("insurance", ["Insurance"]), "Insurance");
  assert.equal(resolveKind("health   insurance", []), "Health insurance");
});

test("kindOptions lists built-ins first, then custom types A-Z once", () => {
  const opts = kindOptions(["school", "Insurance", "Bank", "Insurance", ""]);
  assert.deepEqual(opts.slice(-2), [
    { value: "Bank", label: "Bank" },
    { value: "Insurance", label: "Insurance" },
  ]);
  assert.equal(opts[0].label, "Perks platform");
});
