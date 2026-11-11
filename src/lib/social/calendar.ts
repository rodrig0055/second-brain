import { dayIn } from "./time";

/**
 * What is on which day, across brands.
 *
 * Four kinds of thing land on a calendar and only one of them is automatic:
 * a planned draft is a note to self, a Meta-scheduled post is a promise
 * Facebook made, a published post is history, and a failure is something to
 * fix. They read as different weights rather than different colours, because
 * the colour is already spoken for by the brand.
 *
 * Pure: takes rows, returns entries.
 */

export type CalendarKind = "planned" | "meta_scheduled" | "publishing" | "published" | "failed";

export type CalendarEntry = {
  id: string;
  brandId: string;
  brandSlug: string;
  brandName: string;
  /** The day it belongs on, in the brand's timezone. */
  date: string;
  kind: CalendarKind;
  channel: string;
  caption: string;
  permalink: string | null;
  /** A draft we own, or a post the sync found. */
  source: "draft" | "synced";
  /** Time of day, for the week view. Only Meta-scheduled posts have one. */
  at: Date | null;
};

export type CalendarDraft = {
  id: string;
  brandId: string;
  status: string;
  channel: string;
  caption: string;
  permalink: string | null;
  plannedFor: string | null;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
  timezone: string;
  igMediaId: string | null;
  fbPostId: string | null;
};

export type CalendarPost = {
  externalId: string;
  brandId: string;
  date: string;
  channel: string;
  caption: string;
  permalink: string;
};

export type BrandLookup = Map<string, { slug: string; name: string }>;

function kindOf(status: string): CalendarKind | null {
  switch (status) {
    case "draft":
      return "planned";
    case "scheduled":
      return "meta_scheduled";
    case "publishing":
      return "publishing";
    case "published":
      return "published";
    case "failed":
      return "failed";
    default:
      return null; // discarded, and the legacy approved, belong on no calendar
  }
}

/**
 * Build the calendar. Drafts first, then any synced post we have not already
 * accounted for — a post published outside the app is still part of the week,
 * and one published through the app must not appear twice.
 */
export function buildCalendarEntries(
  drafts: CalendarDraft[],
  synced: CalendarPost[],
  brands: BrandLookup,
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];
  const claimed = new Set<string>();

  for (const d of drafts) {
    const kind = kindOf(d.status);
    if (!kind) continue;
    const brand = brands.get(d.brandId);
    const tz = d.timezone || "Asia/Manila";

    // A draft with no date of any kind is not on the calendar; it is in Drafts.
    let date: string | null = null;
    let at: Date | null = null;
    if (kind === "published" && d.publishedAt) date = dayIn(d.publishedAt, tz);
    else if (kind === "meta_scheduled" && d.scheduledAt) {
      date = dayIn(d.scheduledAt, tz);
      at = d.scheduledAt;
    } else if (d.plannedFor) date = d.plannedFor;
    else if (kind === "failed" || kind === "publishing") date = dayIn(d.updatedAt, tz);
    if (!date) continue;

    if (d.igMediaId) claimed.add(d.igMediaId);
    if (d.fbPostId) claimed.add(d.fbPostId);

    entries.push({
      id: d.id,
      brandId: d.brandId,
      brandSlug: brand?.slug ?? "",
      brandName: brand?.name ?? "",
      date,
      kind,
      channel: d.channel,
      caption: d.caption,
      permalink: d.permalink,
      source: "draft",
      at,
    });
  }

  for (const p of synced) {
    if (claimed.has(p.externalId)) continue;
    const brand = brands.get(p.brandId);
    entries.push({
      id: p.externalId,
      brandId: p.brandId,
      brandSlug: brand?.slug ?? "",
      brandName: brand?.name ?? "",
      date: p.date,
      kind: "published",
      channel: p.channel,
      caption: p.caption,
      permalink: p.permalink || null,
      source: "synced",
      at: null,
    });
  }

  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.brandSlug.localeCompare(b.brandSlug));
}

/** Group entries by day, for a month or week grid. */
export function byDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const out = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const list = out.get(e.date) ?? [];
    list.push(e);
    out.set(e.date, list);
  }
  return out;
}

/** The days of a month grid, padded to whole weeks starting Monday. */
export function monthGrid(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  // getUTCDay is 0 for Sunday; we start weeks on Monday.
  const lead = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - lead * 86_400_000);
  const trail = (7 - ((last.getUTCDay() + 6) % 7) - 1 + 7) % 7;
  const end = new Date(last.getTime() + trail * 86_400_000);

  const days: string[] = [];
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}
