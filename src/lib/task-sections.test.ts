import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSections } from "./task-sections";

test("output with no reference headings is left whole", () => {
  const md = "## 1. Suno Style Box\nacoustic, G major, 82 BPM\n";
  const { head, sections } = splitSections(md);
  assert.equal(sections.length, 0);
  assert.equal(head, md);
});

test("the operator reminder stays above the fold, the two sections fold", () => {
  const md = [
    "## 4. Suno Lyrics Box",
    "```",
    "[Verse]",
    "```",
    "",
    "REMINDER FOR THE OPERATOR: Gate 1 first.",
    "",
    "## 5. Reference research",
    "| Figure | Value | Source |",
    "",
    "## 6. Composition brief",
    "Arc: longing to gratitude.",
    "",
  ].join("\n");

  const { head, sections } = splitSections(md);
  assert.equal(sections.length, 2);
  assert.ok(head.includes("REMINDER FOR THE OPERATOR"), "reminder must stay visible");
  assert.ok(!head.includes("Reference research"));
  assert.deepEqual(
    sections.map((s) => s.title),
    ["Reference research", "Composition brief"],
  );
  assert.equal(sections[0].body, "| Figure | Value | Source |");
  assert.equal(sections[1].body, "Arc: longing to gratitude.");
});

test("heading numbers are optional, so renumbering still folds", () => {
  const { sections } = splitSections("intro\n## Composition brief\nbody\n");
  assert.deepEqual(
    sections.map((s) => s.title),
    ["Composition brief"],
  );
});

test("a heading named mid-prose does not split the output", () => {
  const md = "The ## Composition brief is folded, and Reference research too.\n";
  assert.equal(splitSections(md).sections.length, 0);
});

test("the gloss stays visible and the fact trace folds", () => {
  const md = [
    "## 5. English gloss",
    "| Line | English |",
    "| Mahal kita | I love you |",
    "",
    "REMINDER FOR THE OPERATOR: Gate 1 first.",
    "",
    "## 6. Reference research",
    "| Figure | Value | Source |",
    "",
    "## 7. Fact trace",
    "| Jasmine | named in the story |",
    "",
    "## 8. Composition brief",
    "Arc: anticipation to contentment.",
    "",
  ].join("\n");

  const { head, sections } = splitSections(md);
  // The gloss is what a non-Tagalog reviewer approves at Gate 1, so it must not fold.
  assert.ok(head.includes("English gloss"), "gloss must stay visible");
  assert.ok(head.includes("Mahal kita"));
  assert.ok(head.includes("REMINDER FOR THE OPERATOR"));
  assert.deepEqual(
    sections.map((s) => s.title),
    ["Reference research", "Fact trace", "Composition brief"],
  );
  assert.equal(sections[1].body, "| Jasmine | named in the story |");
});
