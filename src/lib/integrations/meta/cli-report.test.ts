import assert from "node:assert/strict";
import test from "node:test";
import { buildMetaAdReport, formatMetaAdReport } from "./cli-report";
import { detectExactMetaAdLookup } from "./chat-fast-path";

const row = {
  account_id: "2515313311013452",
  account_name: "Acme Florals PH",
  account_currency: "USD",
  date_start: "2026-07-01",
  date_stop: "2026-07-07",
  spend: "9.32",
  impressions: "23444",
  clicks: "121",
  inline_link_clicks: "78",
  actions: [
    { action_type: "omni_purchase", value: "2" },
    { action_type: "landing_page_view", value: "26" },
  ],
  action_values: [{ action_type: "omni_purchase", value: "37.23" }],
  campaign_id: "120299248610792231",
  campaign_name: "App&Web MOF",
  adset_id: "123125011514453802",
  adset_name: "MOF Always On",
  ad_id: "126685233825345159",
  ad_name: "Happiness Guaranteed",
};

test("normalizes exact Meta CLI metrics without changing grain", () => {
  const report = buildMetaAdReport({
    row,
    requestedAdId: "126685233825345159",
    expectedAccountId: "act_2515313311013452",
    currency: "USD",
    timezone: "Asia/Manila",
  });
  assert.equal(report.metrics.spend, 9.32);
  assert.equal(report.metrics.purchases, 2);
  assert.equal(report.metrics.conversionValue, 37.23);
  assert.equal(report.metrics.cir?.toFixed(2), "25.03");
  assert.equal(report.metrics.ctrAll?.toFixed(3), "0.516");
  assert.equal(report.metrics.ctrLink?.toFixed(3), "0.333");
  assert.equal(report.metrics.landingPageViewRate?.toFixed(2), "33.33");
  assert.equal(report.campaign.id, "120299248610792231");
});

test("rejects a response for another ad", () => {
  assert.throws(
    () =>
      buildMetaAdReport({
        row,
        requestedAdId: "990744329076477501",
        expectedAccountId: "act_2515313311013452",
        currency: "USD",
        timezone: "Asia/Manila",
      }),
    /different ad/,
  );
});

test("rejects a response from another ad account", () => {
  assert.throws(
    () =>
      buildMetaAdReport({
        row,
        requestedAdId: "126685233825345159",
        expectedAccountId: "act_9951538332247400",
        currency: "USD",
        timezone: "Asia/Manila",
      }),
    /different ad account/,
  );
});

test("detects exact lookups and uses the official last-30-day default", () => {
  assert.deepEqual(
    detectExactMetaAdLookup(
      "126685233825345159 show spend, purchases, CIR, CTR and campaign ID",
    ),
    { adId: "126685233825345159", dates: { datePreset: "last_30d" } },
  );
  assert.deepEqual(
    detectExactMetaAdLookup(
      "For ad 126685233825345159 show spend from 2026-07-01 to 2026-07-07",
    ),
    {
      adId: "126685233825345159",
      dates: { since: "2026-07-01", until: "2026-07-07" },
    },
  );
  assert.equal(
    detectExactMetaAdLookup(
      "For ad 126685233825345159 show spend from 2026-07-01",
    ),
    null,
  );
});

test("formats a deterministic report", () => {
  const report = buildMetaAdReport({
    row,
    requestedAdId: "126685233825345159",
    expectedAccountId: "act_2515313311013452",
    currency: "USD",
    timezone: "Asia/Manila",
    durationMs: 900,
  });
  const markdown = formatMetaAdReport(report);
  assert.match(markdown, /\$9\.32/);
  assert.match(markdown, /25\.03%/);
  assert.match(markdown, /23,444/);
  assert.match(markdown, /120299248610792231/);
});
