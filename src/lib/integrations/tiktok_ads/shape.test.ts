import assert from "node:assert/strict";
import { test } from "node:test";

import { chunkWindow, parseReportRow } from "./shape";

test("report rows are parsed from TikTok's all-string metrics", () => {
  const m = parseReportRow({
    dimensions: { advertiser_id: "1", stat_time_day: "2026-10-01 00:00:00" },
    metrics: {
      spend: "123.45",
      impressions: "10000",
      clicks: "250",
      conversion: "12",
      complete_payment: "9",
      total_complete_payment_rate: "512.30",
      video_play_actions: "-",
    },
  });
  assert.equal(m.date, "2026-10-01");
  assert.equal(m.spend, 123.45);
  assert.equal(m.purchases, 9);
  // The optimization event and purchases are different numbers; revenue is
  // purchase value, so ROAS must divide it by spend, not by conversions.
  assert.equal(m.conversions, 12);
  assert.equal(m.revenue, 512.3);
  // TikTok sends "-" for a metric with no data; that is zero, not NaN.
  assert.equal(m.videoViews, 0);
});

test("a long window is split into 30-day requests with no gap or overlap", () => {
  const chunks = chunkWindow({ start: "2026-08-01", end: "2026-10-14" }, 30);
  assert.deepEqual(chunks, [
    { start: "2026-08-01", end: "2026-08-30" },
    { start: "2026-08-31", end: "2026-09-29" },
    { start: "2026-09-30", end: "2026-10-14" },
  ]);
  assert.deepEqual(chunkWindow({ start: "2026-10-14", end: "2026-10-14" }, 30), [
    { start: "2026-10-14", end: "2026-10-14" },
  ]);
});
