import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayIn,
  fbScheduleProblem,
  fbScheduleWindow,
  offsetMinutes,
  unixSeconds,
  utcToWallClock,
  wallClockToUtc,
} from "./time";

test("dayIn rolls over at Manila midnight, not UTC midnight", () => {
  // 16:00 UTC is already the next day in Manila (UTC+8).
  assert.equal(dayIn(new Date("2026-09-17T16:00:00Z"), "Asia/Manila"), "2026-09-18");
  assert.equal(dayIn(new Date("2026-09-17T16:00:00Z"), "UTC"), "2026-09-17");
  assert.equal(dayIn(new Date("2026-09-17T15:59:59Z"), "Asia/Manila"), "2026-09-17");
});

test("offsetMinutes reads a fixed and a DST zone", () => {
  assert.equal(offsetMinutes(new Date("2026-09-17T00:00:00Z"), "Asia/Manila"), 480);
  assert.equal(offsetMinutes(new Date("2026-01-15T00:00:00Z"), "Asia/Manila"), 480);
  // London is +60 in summer and 0 in winter.
  assert.equal(offsetMinutes(new Date("2026-07-01T12:00:00Z"), "Europe/London"), 60);
  assert.equal(offsetMinutes(new Date("2026-01-01T12:00:00Z"), "Europe/London"), 0);
});

test("wallClockToUtc resolves a Manila wall clock", () => {
  // 19:00 in Manila is 11:00 UTC.
  assert.equal(
    wallClockToUtc("2026-09-18T19:00", "Asia/Manila")?.toISOString(),
    "2026-09-18T11:00:00.000Z",
  );
  // Midnight, the case most likely to land on the wrong day.
  assert.equal(
    wallClockToUtc("2026-09-18T00:00", "Asia/Manila")?.toISOString(),
    "2026-09-17T16:00:00.000Z",
  );
  assert.equal(
    wallClockToUtc("2026-09-18T23:59", "Asia/Manila")?.toISOString(),
    "2026-09-18T15:59:00.000Z",
  );
});

test("wallClockToUtc gets the offset right across a DST change", () => {
  // London: BST in July (+1), GMT in January (0). A single-pass conversion
  // using today's offset would be an hour out for one of these.
  assert.equal(
    wallClockToUtc("2026-07-15T12:00", "Europe/London")?.toISOString(),
    "2026-07-15T11:00:00.000Z",
  );
  assert.equal(
    wallClockToUtc("2026-01-15T12:00", "Europe/London")?.toISOString(),
    "2026-01-15T12:00:00.000Z",
  );
});

test("wallClockToUtc rejects what is not a wall clock", () => {
  assert.equal(wallClockToUtc(""), null);
  assert.equal(wallClockToUtc("2026-09-18"), null);
  assert.equal(wallClockToUtc("tomorrow evening"), null);
});

test("utcToWallClock round-trips", () => {
  for (const local of ["2026-09-18T19:00", "2026-01-01T00:00", "2026-12-31T23:30"]) {
    const at = wallClockToUtc(local, "Asia/Manila")!;
    assert.equal(utcToWallClock(at, "Asia/Manila"), local);
  }
});

test("the Facebook schedule window is 10 minutes to 75 days", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  const { minAt, maxAt } = fbScheduleWindow(now);
  assert.equal(minAt.toISOString(), "2026-09-18T00:10:00.000Z");
  assert.equal(maxAt.toISOString(), "2026-12-02T00:00:00.000Z");
});

test("fbScheduleProblem names which end of the window was missed", () => {
  const now = new Date("2026-09-18T00:00:00Z");
  assert.equal(fbScheduleProblem(new Date("2026-09-18T01:00:00Z"), now), null);
  assert.match(fbScheduleProblem(new Date("2026-09-18T00:05:00Z"), now)!, /10 minutes/);
  assert.match(fbScheduleProblem(new Date("2026-09-17T23:00:00Z"), now)!, /10 minutes/);
  assert.match(fbScheduleProblem(new Date("2027-01-01T00:00:00Z"), now)!, /75 days/);
  assert.match(fbScheduleProblem(new Date("nope"), now)!, /valid date/);
});

test("unixSeconds is whole seconds", () => {
  assert.equal(unixSeconds(new Date("2026-09-18T00:00:00.750Z")), 1789689600);
});
