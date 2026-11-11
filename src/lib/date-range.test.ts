import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  dateRangeParams,
  dateSpan,
  daysBetween,
  formatRangeLabel,
  isYmd,
  monthBounds,
  parseDateRange,
  presetWindow,
  previousWindow,
  todayIn,
} from "./date-range";

const TODAY = "2026-09-17";

test("isYmd rejects malformed and impossible dates", () => {
  assert.equal(isYmd("2026-09-17"), true);
  assert.equal(isYmd("2026-02-29"), false); // not a leap year
  assert.equal(isYmd("2024-02-29"), true);
  assert.equal(isYmd("2026-13-01"), false);
  assert.equal(isYmd("2026-9-1"), false);
  assert.equal(isYmd(""), false);
  assert.equal(isYmd(undefined), false);
});

test("addDays crosses months and years without drifting", () => {
  assert.equal(addDays("2026-09-17", 1), "2026-09-18");
  assert.equal(addDays("2026-09-01", -1), "2026-08-31");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
});

test("daysBetween is inclusive", () => {
  assert.equal(daysBetween("2026-09-17", "2026-09-17"), 1);
  assert.equal(daysBetween("2026-09-11", "2026-09-17"), 7);
  assert.equal(daysBetween("2026-08-31", "2026-09-01"), 2);
});

test("dateSpan enumerates both ends", () => {
  assert.deepEqual(dateSpan("2026-09-15", "2026-09-17"), [
    "2026-09-15",
    "2026-09-16",
    "2026-09-17",
  ]);
});

test("previousWindow is adjacent and equal length", () => {
  assert.deepEqual(previousWindow("2026-09-11", "2026-09-17"), {
    start: "2026-09-04",
    end: "2026-09-10",
  });
  const prev = previousWindow("2026-09-01", "2026-09-30");
  assert.equal(prev.end, "2026-08-31");
  assert.equal(daysBetween(prev.start, prev.end), 30);
});

test("monthBounds handles offsets across a year boundary", () => {
  assert.deepEqual(monthBounds("2026-09-17"), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(monthBounds("2026-09-17", -1), { start: "2026-08-01", end: "2026-08-31" });
  assert.deepEqual(monthBounds("2026-01-15", -1), { start: "2025-12-01", end: "2025-12-31" });
  assert.deepEqual(monthBounds("2024-02-10"), { start: "2024-02-01", end: "2024-02-29" });
});

test("presetWindow ends today or yesterday as asked", () => {
  assert.deepEqual(presetWindow("7d", TODAY, false), { start: "2026-09-11", end: TODAY });
  assert.deepEqual(presetWindow("7d", TODAY, true), { start: "2026-09-10", end: "2026-09-16" });
  assert.deepEqual(presetWindow("this-month", TODAY, false), {
    start: "2026-09-01",
    end: TODAY,
  });
  assert.deepEqual(presetWindow("last-month", TODAY, false), {
    start: "2026-08-01",
    end: "2026-08-31",
  });
});

test("this-month on the 1st with endsYesterday never inverts", () => {
  const win = presetWindow("this-month", "2026-09-01", true);
  assert.equal(win.start <= win.end, true);
  assert.equal(win.end, "2026-08-31");
});

test("parseDateRange falls back to the caller default", () => {
  const r = parseDateRange({}, { defaultDays: 28, today: TODAY });
  assert.equal(r.preset, "28d");
  assert.equal(r.end, TODAY);
  assert.equal(r.days, 28);
  assert.equal(r.compare, false);
  assert.equal(r.prev, undefined);
  assert.equal(r.label, "Last 28 days");
});

test("parseDateRange honours a named preset", () => {
  const r = parseDateRange({ range: "90d" }, { defaultDays: 7, today: TODAY });
  assert.equal(r.preset, "90d");
  assert.equal(r.days, 90);
});

test("parseDateRange accepts the legacy numeric range and days params", () => {
  const insights = parseDateRange({ range: "30" }, { defaultDays: 7, today: TODAY });
  assert.equal(insights.preset, "30d");
  const ads = parseDateRange({ days: "14" }, { defaultDays: 7, today: TODAY, endsYesterday: true });
  assert.equal(ads.preset, "14d");
  assert.equal(ads.end, "2026-09-16");
});

test("parseDateRange reads a custom window and swaps a reversed one", () => {
  const r = parseDateRange({ from: "2026-09-01", to: "2026-09-05" }, { today: TODAY });
  assert.equal(r.preset, "custom");
  assert.equal(r.start, "2026-09-01");
  assert.equal(r.end, "2026-09-05");
  assert.equal(r.label, "1–5 Sep 2026");

  const flipped = parseDateRange({ from: "2026-09-05", to: "2026-09-01" }, { today: TODAY });
  assert.equal(flipped.start, "2026-09-01");
  assert.equal(flipped.end, "2026-09-05");
});

test("parseDateRange clamps a future end and an over-long span", () => {
  const future = parseDateRange({ from: "2026-09-01", to: "2027-01-01" }, { today: TODAY });
  assert.equal(future.end, TODAY);

  const yest = parseDateRange(
    { from: "2026-09-01", to: "2026-09-30" },
    { today: TODAY, endsYesterday: true },
  );
  assert.equal(yest.end, "2026-09-16");

  const long = parseDateRange(
    { from: "2020-01-01", to: "2026-09-17" },
    { today: TODAY, maxDays: 90 },
  );
  assert.equal(long.days, 90);
});

test("parseDateRange ignores junk and falls through", () => {
  const r = parseDateRange(
    { from: "not-a-date", to: "2026-09-05", range: "nonsense" },
    { defaultDays: 7, today: TODAY },
  );
  assert.equal(r.preset, "7d");
});

test("compare produces an adjacent equal-length window", () => {
  const r = parseDateRange({ range: "7d", compare: "1" }, { today: TODAY });
  assert.equal(r.compare, true);
  assert.deepEqual(r.prev, { start: "2026-09-04", end: "2026-09-10" });
  assert.equal(r.compareLabel, "vs previous 7 days");
  assert.equal(daysBetween(r.prev!.start, r.prev!.end), r.days);
  assert.equal(addDays(r.prev!.end, 1), r.start);
});

test("dateRangeParams round-trips through parseDateRange", () => {
  for (const sp of [
    { range: "30d" },
    { range: "this-month" },
    { from: "2026-08-02", to: "2026-08-19" },
    { range: "14d", compare: "1" },
  ]) {
    const a = parseDateRange(sp, { today: TODAY });
    const b = parseDateRange(dateRangeParams(a), { today: TODAY });
    assert.equal(b.start, a.start);
    assert.equal(b.end, a.end);
    assert.equal(b.compare, a.compare);
  }
});

test("formatRangeLabel collapses what the two ends share", () => {
  assert.equal(formatRangeLabel("2026-09-01", "2026-09-16"), "1–16 Sep 2026");
  assert.equal(formatRangeLabel("2026-08-28", "2026-09-16"), "28 Aug – 16 Sep 2026");
  assert.equal(formatRangeLabel("2025-12-30", "2026-01-02"), "30 Dec 2025 – 2 Jan 2026");
  assert.equal(formatRangeLabel("2026-09-16", "2026-09-16"), "16 Sep 2026");
});

test("todayIn is Manila, which is ahead of UTC late in the day", () => {
  // 2026-09-17T17:00Z is already the 18th in Manila (UTC+8).
  const at = new Date("2026-09-17T17:00:00Z");
  assert.equal(todayIn("Asia/Manila", at), "2026-09-18");
  assert.equal(todayIn("UTC", at), "2026-09-17");
  // A bad timezone falls back rather than throwing.
  assert.equal(todayIn("Not/AZone", at), "2026-09-17");
});
