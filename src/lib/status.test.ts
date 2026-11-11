import { test } from "node:test";
import assert from "node:assert/strict";

import { STATUSES, TONE_COLOR, TONE_DOT, statusInfo } from "./status";

test("known statuses keep their tone and get a readable label", () => {
  assert.deepEqual(statusInfo("draft"), { tone: "attention", label: "Draft" });
  assert.deepEqual(statusInfo("talks"), { tone: "info", label: "In talks" });
  assert.deepEqual(statusInfo("due-soon"), { tone: "attention", label: "Due soon" });
  assert.deepEqual(statusInfo("failed"), { tone: "danger", label: "Failed" });
});

test("unknown statuses read as neutral, humanized", () => {
  assert.deepEqual(statusInfo("waiting_on_vendor"), { tone: "neutral", label: "Waiting on vendor" });
  assert.deepEqual(statusInfo(""), { tone: "neutral", label: "" });
});

test("every status maps to a token colour and a dot variant", () => {
  for (const [key, { tone }] of Object.entries(STATUSES)) {
    assert.ok(TONE_COLOR[tone], `${key} has a colour`);
    assert.ok(TONE_DOT[tone], `${key} has a dot`);
  }
});
