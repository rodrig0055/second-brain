import assert from "node:assert/strict";
import { test } from "node:test";

import { windowFor } from "./window";

const DAY = 86_400_000;

/** Whole days between two YYYY-MM-DD strings. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY,
  );
}

function syncedDaysAgo(days: number) {
  return { lastSyncAt: new Date(Date.now() - days * DAY) };
}

test("a synced connection is re-read across the whole restatement period", () => {
  // Meta credits a purchase to the day of the click, so a sale today can be
  // written back a week. Re-reading only the last 2 days leaves those days
  // frozen at whatever they looked like before the conversions arrived, which
  // always understates and never corrects itself.
  const window = windowFor(syncedDaysAgo(1), 30, 8);
  assert.equal(daysBetween(window.start, window.end), 9);
});

test("the old 2-day overlap would have missed most of Meta's click window", () => {
  const narrow = windowFor(syncedDaysAgo(1), 30, 2);
  const wide = windowFor(syncedDaysAgo(1), 30, 8);
  assert.ok(
    daysBetween(narrow.start, narrow.end) < daysBetween(wide.start, wide.end),
  );
  assert.equal(daysBetween(narrow.start, narrow.end), 3);
});

test("a connection that has never synced uses its full lookback", () => {
  const window = windowFor({ lastSyncAt: null }, 30, 8);
  assert.equal(daysBetween(window.start, window.end), 30);
});

test("a lookback shorter than the restatement period is widened, not shrunk", () => {
  // Otherwise a platform configured with a short lookback would re-read less
  // than it can still change, and the restatement setting would be decorative.
  const window = windowFor({ lastSyncAt: null }, 3, 8);
  assert.equal(daysBetween(window.start, window.end), 8);
});

test("the default restatement stays at the old 2 days for platforms that set none", () => {
  const window = windowFor(syncedDaysAgo(1), 60);
  assert.equal(daysBetween(window.start, window.end), 3);
});

test("a long gap since the last sync is covered from that sync, not truncated", () => {
  // A connection that failed for a fortnight has to come back to the day it
  // stopped, or those days stay permanently empty.
  const window = windowFor(syncedDaysAgo(14), 30, 8);
  assert.equal(daysBetween(window.start, window.end), 22);
});

test("dates come out as plain YYYY-MM-DD, which is what the API and the rows use", () => {
  const window = windowFor(syncedDaysAgo(1), 30, 8);
  for (const value of [window.start, window.end]) {
    assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  }
  assert.ok(window.start < window.end);
});
