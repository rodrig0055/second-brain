import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCalendarEntries, byDay, monthGrid, type CalendarDraft } from "./calendar";

const BRANDS = new Map([
  ["b1", { slug: "bloomly-ph", name: "Bloomly PH" }],
  ["b2", { slug: "acme-florals", name: "Acme Florals" }],
]);

function draft(over: Partial<CalendarDraft> = {}): CalendarDraft {
  return {
    id: "d1",
    brandId: "b1",
    status: "draft",
    channel: "instagram",
    caption: "Roses",
    permalink: null,
    plannedFor: null,
    scheduledAt: null,
    publishedAt: null,
    updatedAt: new Date("2026-09-10T02:00:00Z"),
    timezone: "Asia/Manila",
    igMediaId: null,
    fbPostId: null,
    ...over,
  };
}

test("a planned draft lands on the day it was planned for", () => {
  const [e] = buildCalendarEntries([draft({ plannedFor: "2026-09-20" })], [], BRANDS);
  assert.equal(e.kind, "planned");
  assert.equal(e.date, "2026-09-20");
  assert.equal(e.brandName, "Bloomly PH");
  assert.equal(e.source, "draft");
});

test("a draft with no date at all is not on the calendar", () => {
  assert.deepEqual(buildCalendarEntries([draft()], [], BRANDS), []);
});

test("a Meta-held post lands on its scheduled day, in the brand timezone", () => {
  // 16:00 UTC is already the 19th in Manila.
  const [e] = buildCalendarEntries(
    [draft({ status: "scheduled", scheduledAt: new Date("2026-09-18T16:00:00Z") })],
    [],
    BRANDS,
  );
  assert.equal(e.kind, "meta_scheduled");
  assert.equal(e.date, "2026-09-19");
  assert.equal(e.at?.toISOString(), "2026-09-18T16:00:00.000Z");
});

test("a published draft lands on the day it went out", () => {
  const [e] = buildCalendarEntries(
    [draft({ status: "published", publishedAt: new Date("2026-09-11T01:00:00Z"), plannedFor: "2026-09-01" })],
    [],
    BRANDS,
  );
  assert.equal(e.kind, "published");
  // The day it actually published, not the day someone meant to.
  assert.equal(e.date, "2026-09-11");
});

test("a failure falls back to when it last changed", () => {
  const [e] = buildCalendarEntries([draft({ status: "failed" })], [], BRANDS);
  assert.equal(e.kind, "failed");
  assert.equal(e.date, "2026-09-10");
});

test("discarded drafts are on no calendar", () => {
  assert.deepEqual(
    buildCalendarEntries([draft({ status: "discarded", plannedFor: "2026-09-20" })], [], BRANDS),
    [],
  );
  assert.deepEqual(
    buildCalendarEntries([draft({ status: "approved", plannedFor: "2026-09-20" })], [], BRANDS),
    [],
  );
});

test("a post published outside the app still shows up", () => {
  const entries = buildCalendarEntries([], [
    { externalId: "999", brandId: "b2", date: "2026-09-12", channel: "facebook", caption: "Sale", permalink: "https://fb/999" },
  ], BRANDS);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, "synced");
  assert.equal(entries[0].brandName, "Acme Florals");
});

test("a post published through the app appears once, not twice", () => {
  const entries = buildCalendarEntries(
    [draft({ status: "published", publishedAt: new Date("2026-09-12T02:00:00Z"), igMediaId: "999" })],
    [{ externalId: "999", brandId: "b1", date: "2026-09-12", channel: "instagram", caption: "Roses", permalink: "" }],
    BRANDS,
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, "draft");
});

test("entries sort by day then brand", () => {
  const entries = buildCalendarEntries(
    [
      draft({ id: "a", brandId: "b1", plannedFor: "2026-09-20" }),
      draft({ id: "b", brandId: "b2", plannedFor: "2026-09-19" }),
    ],
    [],
    BRANDS,
  );
  assert.deepEqual(entries.map((e) => e.id), ["b", "a"]);
});

test("byDay groups", () => {
  const entries = buildCalendarEntries(
    [draft({ id: "a", plannedFor: "2026-09-20" }), draft({ id: "b", plannedFor: "2026-09-20" })],
    [],
    BRANDS,
  );
  assert.equal(byDay(entries).get("2026-09-20")?.length, 2);
});

test("monthGrid pads to whole Monday-start weeks", () => {
  // September 2026 starts on a Tuesday and ends on a Wednesday.
  const grid = monthGrid("2026-09");
  assert.equal(grid.length % 7, 0);
  assert.equal(grid[0], "2026-08-31"); // the Monday before
  assert.equal(grid.at(-1), "2026-10-04"); // the Sunday after
  assert.ok(grid.includes("2026-09-01"));
  assert.ok(grid.includes("2026-09-30"));
});
