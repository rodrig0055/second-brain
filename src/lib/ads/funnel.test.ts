import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isFunnel,
  resolveFunnel,
  unmappedAdSets,
  type FunnelAnnotations,
} from "./funnel";

/**
 * Bloomly PH as the audiences tab of the Active Ads sheet records it, verified
 * 2026-09-15.
 *
 * Note `tofNamed`: a second campaign also called "TOF", which is the one
 * holding the MOF ad set. Two campaigns share the name, and one of them is not
 * the funnel its name claims, so the name is not even unique, let alone true.
 */
const POPH = {
  campaigns: {
    TOF: "122435100127155233",
    /** Named "TOF" in Ads Manager. Contains "A - Engaged 60D", which is MOF. */
    tofNamed: "120200042231519122",
    BOF: "23910502047808695",
  },
  adSets: {
    tofVids: "129355557755931211",
    engaged60d: "129366854702012043",
    forcePush: "129525952285350302",
    openVisit30d: "120706697632743941",
    customerList: "125239821412222652",
    cartAbandon14d: "127049278751608261",
  },
};

const ANNOTATIONS: FunnelAnnotations = {
  campaign: {
    [POPH.campaigns.TOF]: { funnel: "TOF" },
    [POPH.campaigns.tofNamed]: { funnel: "MOF" },
    [POPH.campaigns.BOF]: { funnel: "BOF" },
  },
  adset: {
    [POPH.adSets.tofVids]: { funnel: "TOF", audienceLabel: "TOF V2 VIDS" },
    [POPH.adSets.engaged60d]: {
      funnel: "MOF",
      audienceLabel: "A - Engaged 60D",
    },
    [POPH.adSets.forcePush]: {
      funnel: "TOF",
      audienceLabel: "FORCE PUSH TOF",
      isEventAdSet: true,
    },
    [POPH.adSets.openVisit30d]: {
      funnel: "BOF",
      audienceLabel: "A - Open/Visit 30D",
    },
    [POPH.adSets.customerList]: {
      funnel: "BOF",
      audienceLabel: "B - Customer List",
    },
    [POPH.adSets.cartAbandon14d]: {
      funnel: "BOF",
      audienceLabel: "C - Cart Abandon 14D",
    },
  },
};

test("the MOF ad set in a campaign named TOF resolves to MOF", () => {
  // The case the whole module exists for. Reading the campaign name would file
  // this ad set's spend under TOF, and both funnels would be wrong while still
  // adding up to the right account total, so nothing would look broken.
  const resolved = resolveFunnel(
    {
      adSetId: POPH.adSets.engaged60d,
      adSetName: "A - Engaged 60D",
      campaignId: POPH.campaigns.tofNamed,
      campaignName: "TOF",
    },
    ANNOTATIONS,
  );
  assert.equal(resolved.funnel, "MOF");
  assert.equal(resolved.source, "adset");
  assert.equal(resolved.needsReview, false);
  assert.equal(resolved.audienceLabel, "A - Engaged 60D");
});

test("two campaigns share the name TOF, and one of them is MOF", () => {
  // So the name is not merely unreliable, it is not unique either. Anything
  // keyed on campaign name would merge these two into one row.
  const byId = (campaignId: string) =>
    resolveFunnel({ campaignId, campaignName: "TOF" }, ANNOTATIONS).funnel;
  assert.equal(byId(POPH.campaigns.TOF), "TOF");
  assert.equal(byId(POPH.campaigns.tofNamed), "MOF");
});

test("an ad inherits its ad set's funnel, not its campaign's", () => {
  const resolved = resolveFunnel(
    {
      adId: "124930224483736094",
      adSetId: POPH.adSets.engaged60d,
      campaignId: POPH.campaigns.tofNamed,
      campaignName: "TOF",
    },
    ANNOTATIONS,
  );
  assert.equal(resolved.funnel, "MOF");
});

test("an annotation on the ad itself beats its ad set", () => {
  const resolved = resolveFunnel(
    { adId: "ad1", adSetId: POPH.adSets.engaged60d },
    {
      ...ANNOTATIONS,
      ad: { ad1: { funnel: "BOF" } },
    },
  );
  assert.equal(resolved.funnel, "BOF");
  assert.equal(resolved.source, "ad");
});

test("every verified Bloomly PH ad set resolves without guessing", () => {
  const expected: [string, string][] = [
    [POPH.adSets.tofVids, "TOF"],
    [POPH.adSets.engaged60d, "MOF"],
    [POPH.adSets.forcePush, "TOF"],
    [POPH.adSets.openVisit30d, "BOF"],
    [POPH.adSets.customerList, "BOF"],
    [POPH.adSets.cartAbandon14d, "BOF"],
  ];
  for (const [adSetId, funnel] of expected) {
    const resolved = resolveFunnel({ adSetId }, ANNOTATIONS);
    assert.equal(resolved.funnel, funnel, `ad set ${adSetId}`);
    assert.equal(resolved.needsReview, false, `ad set ${adSetId}`);
  }
});

test("an event ad set is flagged so it is judged against its own target", () => {
  const resolved = resolveFunnel(
    { adSetId: POPH.adSets.forcePush },
    ANNOTATIONS,
  );
  assert.equal(resolved.isEventAdSet, true);
  assert.equal(resolved.funnel, "TOF");
  // A regular TOF ad set is not flagged.
  assert.equal(
    resolveFunnel({ adSetId: POPH.adSets.tofVids }, ANNOTATIONS).isEventAdSet,
    false,
  );
});

test("an ad in an event ad set carries the flag too", () => {
  const resolved = resolveFunnel(
    { adId: "ad9", adSetId: POPH.adSets.forcePush },
    { ...ANNOTATIONS, ad: { ad9: { funnel: "TOF" } } },
  );
  assert.equal(resolved.isEventAdSet, true);
});

test("a name guess is returned, but marked for review", () => {
  const resolved = resolveFunnel({
    adSetId: "unknown",
    adSetName: "BOF Cart Abandon 7D",
  });
  assert.equal(resolved.funnel, "BOF");
  assert.equal(resolved.source, "adset-name");
  assert.equal(resolved.needsReview, true);
});

test("a campaign-name guess says why it is the least trustworthy signal", () => {
  const resolved = resolveFunnel({
    adSetId: "unknown",
    adSetName: "A - Engaged 60D",
    campaignName: "TOF",
  });
  assert.equal(resolved.funnel, "TOF");
  assert.equal(resolved.source, "campaign-name");
  assert.equal(resolved.needsReview, true);
  assert.match(resolved.explanation, /confirm it against the ad set/i);
});

test("an unknown ad set returns nothing rather than defaulting to TOF", () => {
  // A default would be indistinguishable from knowledge once it is in a table.
  const resolved = resolveFunnel({
    adSetId: "122580126545900346",
    adSetName: "Test audience",
  });
  assert.equal(resolved.funnel, null);
  assert.equal(resolved.source, "unmapped");
});

test("a name that mentions two stages resolves to neither", () => {
  assert.equal(resolveFunnel({ adSetName: "TOF to MOF test" }).funnel, null);
});

test("funnel letters are matched as whole words", () => {
  assert.equal(resolveFunnel({ adSetName: "BOFFO creative" }).funnel, null);
  assert.equal(resolveFunnel({ adSetName: "Profile taps" }).funnel, null);
  assert.equal(resolveFunnel({ adSetName: "bof retarget" }).funnel, "BOF");
});

test("unmapped ad sets are listed by spend, so the biggest gap shows first", () => {
  const rows = [
    { adSetId: POPH.adSets.tofVids, adSetName: "TOF V2 VIDS", spend: 20 },
    { adSetId: "new-1", adSetName: "Untitled ad set", spend: 5 },
    { adSetId: "new-2", adSetName: "Test", spend: 11 },
    { adSetId: "new-1", adSetName: "Untitled ad set", spend: 7 },
  ];
  const gaps = unmappedAdSets(rows, ANNOTATIONS);
  assert.equal(gaps.length, 2);
  assert.equal(gaps[0].adSetId, "new-1");
  assert.equal(gaps[0].spend, 12);
  assert.equal(gaps[1].adSetId, "new-2");
});

test("nothing is unmapped once every ad set is annotated", () => {
  const rows = Object.values(POPH.adSets).map((adSetId) => ({
    adSetId,
    spend: 10,
  }));
  assert.deepEqual(unmappedAdSets(rows, ANNOTATIONS), []);
});

test("isFunnel guards values coming back out of the database", () => {
  assert.equal(isFunnel("TOF"), true);
  assert.equal(isFunnel("tof"), false);
  assert.equal(isFunnel(null), false);
  assert.equal(isFunnel(undefined), false);
});
