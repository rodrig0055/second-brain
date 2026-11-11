import assert from "node:assert/strict";
import { test } from "node:test";

import { withRates } from "@/lib/ads/metrics";
import type { InsightRow } from "./client";
import { pickAction, rowCounters, rowEntity, rowReach } from "./counters";

function insight(partial: Partial<InsightRow>): InsightRow {
  return { date_start: "2026-09-13", date_stop: "2026-09-13", ...partial };
}

test("a purchase reported under several action types is counted once", () => {
  // Meta returns the same purchases under the omni metric, the pixel metric and
  // the bare one. Summing would report 3 purchases and PHP 66.75 where the
  // truth is 1 and 22.25.
  const row = insight({
    actions: [
      { action_type: "omni_purchase", value: "1" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "1" },
      { action_type: "purchase", value: "1" },
    ],
    action_values: [
      { action_type: "omni_purchase", value: "22.25" },
      { action_type: "offsite_conversion.fb_pixel_purchase", value: "22.25" },
      { action_type: "purchase", value: "22.25" },
    ],
  });
  const counters = rowCounters(row);
  assert.equal(counters.purchases, 1);
  assert.equal(counters.purchaseValue, 22.25);
});

test("landing page views prefer the plain type over the omni variant", () => {
  // Verified against 2,462 stored Acme Florals rows: this account reports both,
  // and the omni figure is higher. The trackers were built from Ads Manager's
  // "Landing page views" column, which is the plain one.
  const counters = rowCounters(
    insight({
      actions: [
        { action_type: "omni_landing_page_view", value: "130" },
        { action_type: "landing_page_view", value: "117" },
      ],
    }),
  );
  assert.equal(counters.landingPageViews, 117);
});

test("landing page views fall back to the omni variant when alone", () => {
  const counters = rowCounters(
    insight({
      actions: [{ action_type: "omni_landing_page_view", value: "130" }],
    }),
  );
  assert.equal(counters.landingPageViews, 130);
});

test("the pixel metric is used when the omni one is absent", () => {
  const counters = rowCounters(
    insight({
      actions: [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "4" },
      ],
    }),
  );
  assert.equal(counters.purchases, 4);
});

test("add to cart and initiate checkout are picked, not summed across types", () => {
  const counters = rowCounters(
    insight({
      actions: [
        { action_type: "omni_add_to_cart", value: "6" },
        { action_type: "offsite_conversion.fb_pixel_add_to_cart", value: "6" },
        { action_type: "omni_initiated_checkout", value: "10" },
        {
          action_type: "offsite_conversion.fb_pixel_initiate_checkout",
          value: "10",
        },
      ],
    }),
  );
  assert.equal(counters.addToCart, 6);
  assert.equal(counters.initiateCheckout, 10);
  // Warm is the sum of the two distinct events, which is a real sum.
  assert.equal(withRates(counters).warm, 16);
});

test("outbound clicks come from their own list, apart from clicks and link clicks", () => {
  const counters = rowCounters(
    insight({
      clicks: "320",
      inline_link_clicks: "240",
      outbound_clicks: [{ action_type: "outbound_click", value: "200" }],
      impressions: "26435",
    }),
  );
  assert.equal(counters.clicksAll, 320);
  assert.equal(counters.linkClicks, 240);
  assert.equal(counters.outboundClicks, 200);
});

test("the dedicated play field wins over the video_view action", () => {
  // `video_view` inside `actions` has not meant the same thing across versions,
  // so the explicit field is the one to trust when both arrive.
  const counters = rowCounters(
    insight({
      video_play_actions: [{ action_type: "video_view", value: "2500" }],
      actions: [{ action_type: "video_view", value: "9999" }],
    }),
  );
  assert.equal(counters.videoViews3s, 2500);
});

test("rows synced before v25.0 still read their legacy play field", () => {
  // video_3_sec_watched_actions was removed from the API, but rows already in
  // integration_records carry it and must not silently drop to zero.
  const counters = rowCounters(
    insight({
      video_3_sec_watched_actions: [
        { action_type: "video_view", value: "2500" },
      ],
    } as Partial<InsightRow>),
  );
  assert.equal(counters.videoViews3s, 2500);
});

test("3-second plays fall back to the action when the field is absent", () => {
  const counters = rowCounters(
    insight({ actions: [{ action_type: "video_view", value: "2500" }] }),
  );
  assert.equal(counters.videoViews3s, 2500);
});

test("a static ad reports zero video counters rather than undefined", () => {
  const counters = rowCounters(insight({ impressions: "10000" }));
  assert.equal(counters.videoViews3s, 0);
  assert.equal(counters.thruPlays, 0);
  for (const value of Object.values(counters)) {
    assert.equal(typeof value, "number");
  }
});

test("a whole row becomes the metrics the tracker shows", () => {
  // POPH Daily Tracker, Sep 13 2026 TOTAL.
  const counters = rowCounters(
    insight({
      spend: "36.70",
      impressions: "26435",
      outbound_clicks: [{ action_type: "outbound_click", value: "320" }],
      actions: [
        { action_type: "omni_purchase", value: "1" },
        { action_type: "landing_page_view", value: "117" },
        { action_type: "omni_add_to_cart", value: "6" },
        { action_type: "omni_initiated_checkout", value: "10" },
      ],
      action_values: [{ action_type: "omni_purchase", value: "22.25" }],
      reach: "15761",
    }),
  );
  const totals = withRates(counters);
  assert.equal(totals.cir.toFixed(2), "164.94");
  assert.equal(totals.cpp.toFixed(2), "36.70");
  assert.equal(totals.warm, 16);
  assert.equal(rowReach(insight({ reach: "15761" })), 15761);
});

test("malformed values read as zero instead of poisoning every sum", () => {
  const counters = rowCounters(
    insight({
      spend: "not a number",
      actions: [{ action_type: "omni_purchase", value: "" }],
    }),
  );
  assert.equal(counters.spend, 0);
  assert.equal(counters.purchases, 0);
});

test("pickAction stops at the first type present, in the order given", () => {
  const stats = [
    { action_type: "second", value: "2" },
    { action_type: "first", value: "1" },
  ];
  assert.equal(pickAction(stats, ["first", "second"]), 1);
  assert.equal(pickAction(stats, ["missing", "second"]), 2);
  assert.equal(pickAction(stats, ["missing"]), 0);
  assert.equal(pickAction(undefined, ["first"]), 0);
});

test("a row names the narrowest entity it carries", () => {
  assert.deepEqual(
    rowEntity(insight({ campaign_id: "c1", adset_id: "s1", ad_id: "a1", ad_name: "Ad" })),
    { level: "ad", id: "a1", name: "Ad" },
  );
  assert.deepEqual(
    rowEntity(insight({ campaign_id: "c1", adset_id: "s1", adset_name: "MOF" })),
    { level: "adset", id: "s1", name: "MOF" },
  );
  assert.equal(rowEntity(insight({ campaign_id: "c1" })).level, "campaign");
  assert.equal(rowEntity(insight({})).level, "account");
});

test("an unnamed entity falls back to its id rather than going blank", () => {
  assert.equal(rowEntity(insight({ adset_id: "129366854702012043" })).name, "129366854702012043");
});
