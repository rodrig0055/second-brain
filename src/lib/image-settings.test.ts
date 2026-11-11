import assert from "node:assert/strict";
import { test } from "node:test";
import {
  manualSettings,
  parseSettings,
  planningCaption,
  ruleSettings,
  settingsFromKind,
  takesSettings,
} from "./image-settings";

test("GIF and SVG plan fully by rule; stills are read", () => {
  assert.equal(ruleSettings({ hasReferences: false, output: "gif" })?.complexity, "high");
  assert.equal(ruleSettings({ hasReferences: true, output: "svg" })?.complexity, "high");
  assert.equal(ruleSettings({ hasReferences: true, output: "image" }), null);
  assert.equal(ruleSettings({ hasReferences: false, output: "image" }), null);
});

test("with references, the brief kind sets the planning depth", () => {
  assert.equal(settingsFromKind("edit", false, true).complexity, "low");
  assert.equal(settingsFromKind("product_scene", false, true).complexity, "medium");
  assert.equal(settingsFromKind("layout", true, true).complexity, "high");
  assert.equal(settingsFromKind("open", false, true).complexity, "high");
});

test("without references every kind plans fully, but detail still counts", () => {
  const s = settingsFromKind("edit", true, false);
  assert.equal(s.complexity, "high");
  assert.equal(s.fineDetail, true);
  assert.match(s.reason, /quality step higher/);
});

test("reasons never carry dashes (house style)", () => {
  for (const kind of ["edit", "product_scene", "layout", "open"] as const) {
    for (const refs of [true, false]) {
      assert.doesNotMatch(settingsFromKind(kind, true, refs).reason, /[–—]/);
    }
  }
});

test("settings from the studio are validated", () => {
  const good = JSON.stringify(manualSettings("low", true));
  assert.deepEqual(parseSettings(good), { complexity: "low", fineDetail: true, source: "manual", reason: "Set by you." });
  assert.equal(parseSettings(JSON.stringify({ complexity: "max", source: "auto" })), null);
  assert.equal(parseSettings("not json"), null);
  assert.equal(parseSettings(null), null);
});

test("only 2.6 takes complexity (2.5 rejects it)", () => {
  assert.ok(takesSettings("openai/gpt-image-2.6-flare"));
  assert.ok(!takesSettings("openai/gpt-image-2.5-sunburst"));
  assert.ok(!takesSettings("google/gemini-nano-banana-2.1"));
});

test("caption names the level and who chose it", () => {
  assert.equal(planningCaption({ complexity: "low", source: "auto" }), " · low planning (auto)");
  assert.equal(planningCaption({ complexity: "high", source: "manual" }), " · high planning (set by you)");
  assert.equal(planningCaption(undefined), "");
});
