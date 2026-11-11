import { test } from "node:test";
import assert from "node:assert/strict";

import {
  cycleCalendar,
  cycleDay,
  defaultRetestOn,
  isOwnDomain,
  linksInText,
  mentionsBrand,
  normaliseBrand,
  phaseOf,
  priority,
  suggestDecision,
  suggestedBlock,
} from "./model";
import { bilingualTopicRuns, summarize, topCitedDomains, topCompetitors, topicLift, type ScoredRun } from "./score";

const run = (over: Partial<ScoredRun> = {}): ScoredRun => ({
  promptId: "p",
  platform: "chatgpt",
  runOn: "2026-11-09",
  topic: "same-day",
  stage: "decision",
  language: "en",
  appeared: false,
  recommended: false,
  cited: false,
  position: null,
  brands: [],
  citations: [],
  accuracyIssues: null,
  ...over,
});

test("brand mention matches whole names, never the generic phrase", () => {
  const aliases = ["acme florals", "acmeflorals", "acmeflorals.example"];
  const domains = ["acmeflorals.example"];
  assert.equal(mentionsBrand("Try Acme Florals for same-day.", aliases, domains), true);
  assert.equal(mentionsBrand("Order at acmeflorals.example today", aliases, domains), true);
  assert.equal(mentionsBrand("Visit a local flower store near you", aliases, domains), false);
  assert.equal(mentionsBrand("Myacmefloralsshop is a different shop", aliases, domains), false);
  assert.equal(mentionsBrand("see sub.acmeflorals.examplex.com", aliases, domains), false);
});

test("own domain includes subdomains only", () => {
  assert.equal(isOwnDomain("acmeflorals.example", ["acmeflorals.example"]), true);
  assert.equal(isOwnDomain("www.acmeflorals.example", ["acmeflorals.example"]), true);
  assert.equal(isOwnDomain("blog.acmeflorals.example", ["acmeflorals.example"]), true);
  assert.equal(isOwnDomain("notacmeflorals.example", ["acmeflorals.example"]), false);
});

test("links are read out of the answer text", () => {
  assert.deepEqual(linksInText("See [AF](https://acmeflorals.example/same-day). Or https://x.com/a."), [
    "https://acmeflorals.example/same-day",
    "https://x.com/a",
  ]);
});

test("brand names normalise across case and domain suffix", () => {
  assert.equal(normaliseBrand("Acme Florals"), "acmeflorals");
  assert.equal(normaliseBrand("ACME FLORALS"), "acmeflorals");
  assert.equal(normaliseBrand("Gifts & Flowers PH"), "giftsflowers");
});

test("priority and blocks follow the evidence override", () => {
  assert.equal(priority(3, 1), 3);
  assert.equal(priority(1, 3), 1 / 3);
  assert.equal(suggestedBlock("good_to_have", 3, 1), 1);
  assert.equal(suggestedBlock("good_to_have", 1, 2), 2);
  // A Do action with effort 3 starts in block 1 whatever its score.
  assert.equal(suggestedBlock("do", 1, 3), 1);
  assert.equal(suggestedBlock("only_if", 1, 3), 2);
});

test("cycle calendar: 15 planning, two 30-day blocks, re-test on day 76", () => {
  const cal = cycleCalendar("2026-11-09");
  assert.deepEqual(cal.planning, { from: "2026-11-09", to: "2026-11-23" });
  assert.deepEqual(cal.block1, { from: "2026-11-24", to: "2026-12-23" });
  assert.deepEqual(cal.block2, { from: "2026-12-24", to: "2027-01-22" });
  assert.equal(cal.retest.from, defaultRetestOn("2026-11-09"));
  assert.equal(cycleDay("2026-11-09", cal.retest.from), 76);
  assert.equal(phaseOf(1), "planning");
  assert.equal(phaseOf(16), "block1");
  assert.equal(phaseOf(46), "block2");
  assert.equal(phaseOf(76), "retest");
  assert.equal(phaseOf(91), "done");
});

test("re-test decision from lift over control", () => {
  assert.equal(suggestDecision(null), null);
  assert.equal(suggestDecision(0.2)?.decision, "expand");
  assert.equal(suggestDecision(0.08)?.decision, "keep");
  assert.equal(suggestDecision(0.01)?.decision, "revise");
  assert.equal(suggestDecision(-0.1)?.decision, "stop");
});

test("summary rates are null with no answers, never zero", () => {
  const s = summarize([]);
  assert.equal(s.visibility, null);
  assert.equal(s.winRate, null);
});

test("summary: visibility, mention share and win rate", () => {
  const us = { name: "Acme Florals", domain: null, recommended: true };
  const rival = { name: "Rival", domain: null, recommended: true };
  const s = summarize([
    run({ appeared: true, recommended: true, position: 1, brands: [us, rival], accuracyIssues: [] }),
    run({ appeared: true, position: 2, brands: [rival, us], accuracyIssues: ["wrong cutoff"] }),
    run({ brands: [rival] }),
    // Named by the regex but missed by the judge: counted once, no win base.
    run({ appeared: true, brands: [rival] }),
  ]);
  assert.equal(s.answers, 4);
  assert.equal(s.visibility, 0.75);
  assert.equal(s.recommendation, 0.25);
  assert.equal(s.winBase, 2);
  assert.equal(s.winRate, 0.5);
  // 3 of ours over 3 ours + 4 rival mentions.
  assert.equal(s.mentionShare, 3 / 7);
  assert.equal(s.accuracyChecked, 2);
  assert.equal(s.accuracyClean, 1);
});

test("competitors exclude us and count once per answer", () => {
  const runs = [
    run({ brands: [{ name: "Acme Florals", domain: null, recommended: false }, { name: "Rival", domain: null, recommended: false }, { name: "rival", domain: null, recommended: false }] }),
    run({ brands: [{ name: "Other", domain: null, recommended: false }] }),
  ];
  const top = topCompetitors(runs, ["Acme Florals", "acmeflorals.example"]);
  assert.deepEqual(
    top.map((c) => [c.name, c.answers]),
    [
      ["Other", 1],
      ["Rival", 1],
    ],
  );
});

test("cited domains drop our own", () => {
  const runs = [
    run({ citations: [{ url: "https://acmeflorals.example/a", domain: "acmeflorals.example", title: "" }, { url: "https://reddit.com/x", domain: "reddit.com", title: "" }] }),
    run({ citations: [{ url: "https://reddit.com/y", domain: "reddit.com", title: "" }] }),
  ];
  assert.deepEqual(topCitedDomains(runs, (d) => isOwnDomain(d, ["acmeflorals.example"])), [{ domain: "reddit.com", answers: 2 }]);
});

test("topic lift nets out the control topics", () => {
  const before = [run({ topic: "a" }), run({ topic: "a" }), run({ topic: "b" }), run({ topic: "b", appeared: true })];
  const after = [run({ topic: "a", appeared: true }), run({ topic: "a" }), run({ topic: "b", appeared: true }), run({ topic: "b", appeared: true })];
  // a: 0 -> 0.5; control b: 0.5 -> 1. Net 0.
  assert.equal(topicLift(before, after, "a", ["a", "b"]), 0);
  assert.equal(topicLift(before, after, "a", []), 0.5);
  assert.equal(topicLift([], after, "a", ["b"]), null);
});

test("language split keeps only topics asked in both languages", () => {
  const runs = [
    run({ topic: "same-day", language: "en" }),
    run({ topic: "same-day", language: "tl" }),
    run({ topic: "birthday", language: "en" }),
  ];
  assert.deepEqual(
    bilingualTopicRuns(runs).map((r) => `${r.topic}:${r.language}`),
    ["same-day:en", "same-day:tl"],
  );
});
