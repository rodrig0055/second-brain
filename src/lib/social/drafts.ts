import "server-only";

import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { brands, socialPostDrafts, users } from "@/db/schema";
import type { SocialDraft } from "@/lib/integrations/meta_organic/publish";
import { STALE_AFTER_MINUTES } from "@/lib/social/publisher";
import { buildCalendarEntries, type CalendarEntry } from "@/lib/social/calendar";
import { loadPostsTable } from "@/lib/social/metrics";

/** Everything a person needs to see beside a draft. */
export type DraftView = SocialDraft & {
  brandName: string;
  brandSlug: string;
  authorName: string;
  editorName: string;
  publisherName: string;
  /** Claimed for publishing long enough ago that it is not coming back. */
  isStalled: boolean;
};

export type DraftStatus = SocialDraft["status"];

export type DraftFilter = {
  brandIds: string[];
  statuses?: DraftStatus[];
  channel?: "instagram" | "facebook" | "both";
  search?: string;
  /** On `planned_for`. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

const STALE_MS = STALE_AFTER_MINUTES * 60_000;

async function decorate(rows: SocialDraft[]): Promise<DraftView[]> {
  if (rows.length === 0) return [];

  const brandIds = [...new Set(rows.map((r) => r.brandId))];
  const brandRows = await db.select().from(brands).where(inArray(brands.id, brandIds));
  const brandById = new Map(brandRows.map((b) => [b.id, b]));

  const userIds = [
    ...new Set(
      rows.flatMap((r) => [r.createdById, r.lastEditedById, r.publishedById]).filter(Boolean),
    ),
  ] as string[];
  const people = userIds.length
    ? await db.select().from(users).where(inArray(users.id, userIds))
    : [];
  const nameOf = new Map(people.map((p) => [p.id, p.name || p.email]));

  const staleBefore = Date.now() - STALE_MS;
  return rows.map((r) => ({
    ...r,
    brandName: brandById.get(r.brandId)?.name ?? "",
    brandSlug: brandById.get(r.brandId)?.slug ?? "",
    authorName: r.createdById ? (nameOf.get(r.createdById) ?? "") : "",
    editorName: r.lastEditedById ? (nameOf.get(r.lastEditedById) ?? "") : "",
    publisherName: r.publishedById ? (nameOf.get(r.publishedById) ?? "") : "",
    isStalled:
      r.status === "publishing" && (r.claimedAt?.getTime() ?? 0) < staleBefore,
  }));
}

/** The Drafts table. No hard cap: it pages instead of silently truncating. */
export async function listDrafts(
  filter: DraftFilter,
): Promise<{ rows: DraftView[]; total: number }> {
  const { brandIds, statuses, channel, search, from, to, limit = 200, offset = 0 } = filter;
  if (brandIds.length === 0) return { rows: [], total: 0 };

  const where = and(
    inArray(socialPostDrafts.brandId, brandIds),
    statuses?.length ? inArray(socialPostDrafts.status, statuses) : undefined,
    channel ? eq(socialPostDrafts.channel, channel) : undefined,
    search ? ilike(socialPostDrafts.caption, `%${search}%`) : undefined,
    from ? gte(socialPostDrafts.plannedFor, from) : undefined,
    to ? lte(socialPostDrafts.plannedFor, to) : undefined,
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(socialPostDrafts)
      .where(where)
      .orderBy(desc(socialPostDrafts.updatedAt))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(socialPostDrafts).where(where),
  ]);

  return { rows: await decorate(rows), total: totals[0]?.n ?? 0 };
}

/** How many drafts sit in each state, for the status chips. */
export async function draftCounts(
  brandIds: string[],
): Promise<Record<string, number>> {
  if (brandIds.length === 0) return {};
  const rows = await db
    .select({ status: socialPostDrafts.status, n: count() })
    .from(socialPostDrafts)
    .where(inArray(socialPostDrafts.brandId, brandIds))
    .groupBy(socialPostDrafts.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}

/** The same, split per brand, for the scope bar badges. */
export async function pendingByBrand(brandIds: string[]): Promise<Record<string, number>> {
  if (brandIds.length === 0) return {};
  const rows = await db
    .select({ brandId: socialPostDrafts.brandId, n: count() })
    .from(socialPostDrafts)
    .where(
      and(
        inArray(socialPostDrafts.brandId, brandIds),
        inArray(socialPostDrafts.status, ["draft", "failed"]),
      ),
    )
    .groupBy(socialPostDrafts.brandId);
  return Object.fromEntries(rows.map((r) => [r.brandId, r.n]));
}

export async function loadDraft(id: string): Promise<SocialDraft | null> {
  return (
    (await db.query.socialPostDrafts.findFirst({ where: eq(socialPostDrafts.id, id) })) ?? null
  );
}

export async function loadDraftView(id: string): Promise<DraftView | null> {
  const row = await loadDraft(id);
  if (!row) return null;
  return (await decorate([row]))[0] ?? null;
}

/** Everything a person should be told about before it becomes a problem. */
export type Attention = {
  failed: DraftView[];
  stalled: DraftView[];
  upcoming: DraftView[];
};

export async function loadAttention(brandIds: string[], today: string): Promise<Attention> {
  if (brandIds.length === 0) return { failed: [], stalled: [], upcoming: [] };

  const horizon = new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [failed, publishing, upcoming] = await Promise.all([
    db
      .select()
      .from(socialPostDrafts)
      .where(
        and(inArray(socialPostDrafts.brandId, brandIds), eq(socialPostDrafts.status, "failed")),
      )
      .orderBy(desc(socialPostDrafts.updatedAt))
      .limit(20),
    db
      .select()
      .from(socialPostDrafts)
      .where(
        and(inArray(socialPostDrafts.brandId, brandIds), eq(socialPostDrafts.status, "publishing")),
      )
      .limit(20),
    db
      .select()
      .from(socialPostDrafts)
      .where(
        and(
          inArray(socialPostDrafts.brandId, brandIds),
          or(
            eq(socialPostDrafts.status, "scheduled"),
            and(
              eq(socialPostDrafts.status, "draft"),
              isNotNull(socialPostDrafts.plannedFor),
              gte(socialPostDrafts.plannedFor, today),
              lte(socialPostDrafts.plannedFor, horizon),
            ),
          ),
        ),
      )
      .orderBy(asc(sql`coalesce(${socialPostDrafts.scheduledAt}::date, ${socialPostDrafts.plannedFor})`))
      .limit(20),
  ]);

  const [failedViews, publishingViews, upcomingViews] = await Promise.all([
    decorate(failed),
    decorate(publishing),
    decorate(upcoming),
  ]);

  return {
    failed: failedViews,
    // Only the ones that are genuinely stuck; one in flight is not a problem.
    stalled: publishingViews.filter((d) => d.isStalled),
    upcoming: upcomingViews,
  };
}

/** The calendar, drafts and synced posts together. */
export async function loadCalendarEntries(
  brandIds: string[],
  from: string,
  to: string,
): Promise<CalendarEntry[]> {
  if (brandIds.length === 0) return [];

  const [draftRows, brandRows, posts] = await Promise.all([
    db
      .select()
      .from(socialPostDrafts)
      .where(inArray(socialPostDrafts.brandId, brandIds))
      .orderBy(desc(socialPostDrafts.updatedAt))
      .limit(500),
    db.select().from(brands).where(inArray(brands.id, brandIds)),
    loadPostsTable({ brandIds, startDate: from, endDate: to }),
  ]);

  const lookup = new Map(brandRows.map((b) => [b.id, { slug: b.slug, name: b.name }]));

  const entries = buildCalendarEntries(
    draftRows.map((d) => ({
      id: d.id,
      brandId: d.brandId,
      status: d.status,
      channel: d.channel,
      caption: d.caption,
      permalink: d.permalink,
      plannedFor: d.plannedFor,
      scheduledAt: d.scheduledAt,
      publishedAt: d.publishedAt,
      updatedAt: d.updatedAt,
      timezone: d.timezone,
      igMediaId: d.igMediaId,
      fbPostId: d.fbPostId,
    })),
    posts.map((p) => ({
      externalId: p.externalId,
      brandId: p.brandId,
      date: p.date,
      channel: p.channel,
      caption: p.caption,
      permalink: p.permalink,
    })),
    lookup,
  );

  return entries.filter((e) => e.date >= from && e.date <= to);
}
