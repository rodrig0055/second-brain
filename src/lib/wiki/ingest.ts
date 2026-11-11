import { generateObject } from "ai";
import { z } from "zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  brands,
  feedProductChanges,
  knowledgeDocs,
  metricsDaily,
  sitemapUrlChanges,
  storefrontSnapshots,
} from "@/db/schema";
import { resolveModel } from "@/lib/models";
import { logUsage } from "@/lib/usage";
import { regenerateWikiIndex } from "./index-doc";
import { logWikiActivity, WIKI_MODEL } from "./shared";

const DIGEST_TITLE = "Weekly data digest";

type WikiBrand = { id: string; slug: string; name: string; domain: string };

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Karpathy's ingest: once a week, per brand, rewrite a single "Weekly data
 * digest" wiki-page from cheap DB aggregates (no live API calls — the syncs
 * already landed the data). buildSystemPrompt injects the page into every chat
 * for the brand, so the agent always knows the current state without tools.
 */
async function gatherAggregates(brand: WikiBrand): Promise<string> {
  const sections: string[] = [];
  const now = new Date();
  const since7 = new Date(now);
  since7.setUTCDate(since7.getUTCDate() - 7);

  // Storefront: latest 2 snapshots per source → week-over-week deltas.
  const snaps = await db
    .select({
      source: storefrontSnapshots.source,
      totalItems: storefrontSnapshots.totalItems,
      addedCount: storefrontSnapshots.addedCount,
      removedCount: storefrontSnapshots.removedCount,
      changedCount: storefrontSnapshots.changedCount,
      summary: storefrontSnapshots.summary,
      capturedAt: storefrontSnapshots.capturedAt,
    })
    .from(storefrontSnapshots)
    .where(
      and(
        eq(storefrontSnapshots.brandId, brand.id),
        eq(storefrontSnapshots.status, "done"),
      ),
    )
    .orderBy(desc(storefrontSnapshots.capturedAt))
    .limit(4);
  if (snaps.length > 0) {
    const lines = snaps.map(
      (s) =>
        `- ${s.source} @ ${ymd(s.capturedAt)}: total=${s.totalItems}, +${s.addedCount}/-${s.removedCount}/~${s.changedCount}, ${JSON.stringify(s.summary)}`,
    );
    sections.push(`## Storefront snapshots (latest first)\n${lines.join("\n")}`);
  }

  // Feed churn last 7d: counts by kind/field + a few samples.
  const feedCounts = await db
    .select({
      changeKind: feedProductChanges.changeKind,
      field: feedProductChanges.field,
      n: sql<number>`count(*)::int`,
    })
    .from(feedProductChanges)
    .where(
      and(
        eq(feedProductChanges.brandId, brand.id),
        gte(feedProductChanges.detectedAt, since7),
      ),
    )
    .groupBy(feedProductChanges.changeKind, feedProductChanges.field);
  if (feedCounts.length > 0) {
    const samples = await db
      .select({
        title: feedProductChanges.title,
        changeKind: feedProductChanges.changeKind,
        field: feedProductChanges.field,
        oldValue: feedProductChanges.oldValue,
        newValue: feedProductChanges.newValue,
      })
      .from(feedProductChanges)
      .where(
        and(
          eq(feedProductChanges.brandId, brand.id),
          gte(feedProductChanges.detectedAt, since7),
        ),
      )
      .orderBy(desc(feedProductChanges.detectedAt))
      .limit(15);
    sections.push(
      `## Product feed changes (last 7 days)\nCounts: ${feedCounts
        .map((c) => `${c.changeKind}${c.field ? `/${c.field}` : ""}=${c.n}`)
        .join(", ")}\nSamples:\n${samples
        .map(
          (s) =>
            `- ${s.changeKind} ${s.title}${s.field ? ` (${s.field}: ${s.oldValue} → ${s.newValue})` : ""}`,
        )
        .join("\n")}`,
    );
  }

  // Sitemap churn last 7d.
  const smCounts = await db
    .select({
      urlType: sitemapUrlChanges.urlType,
      changeKind: sitemapUrlChanges.changeKind,
      n: sql<number>`count(*)::int`,
    })
    .from(sitemapUrlChanges)
    .where(
      and(
        eq(sitemapUrlChanges.brandId, brand.id),
        gte(sitemapUrlChanges.detectedAt, since7),
      ),
    )
    .groupBy(sitemapUrlChanges.urlType, sitemapUrlChanges.changeKind);
  if (smCounts.length > 0) {
    sections.push(
      `## Sitemap changes (last 7 days)\n${smCounts
        .map((c) => `- ${c.changeKind} ${c.urlType}: ${c.n}`)
        .join("\n")}`,
    );
  }

  // Platform metrics: account-level sums, last-7d vs prior-7d.
  const window = async (start: string, end: string) =>
    db
      .select({
        platform: metricsDaily.platform,
        spend: sql<string>`sum(${metricsDaily.spend})`,
        revenue: sql<string>`sum(${metricsDaily.revenue})`,
        orders: sql<number>`sum(${metricsDaily.orders})::int`,
        sessions: sql<number>`sum(${metricsDaily.sessions})::int`,
        clicks: sql<number>`sum(${metricsDaily.clicks})::int`,
        impressions: sql<number>`sum(${metricsDaily.impressions})::int`,
        emailsSent: sql<number>`sum(${metricsDaily.emailsSent})::int`,
        opens: sql<number>`sum(${metricsDaily.opens})::int`,
      })
      .from(metricsDaily)
      .where(
        and(
          eq(metricsDaily.brandId, brand.id),
          eq(metricsDaily.dimensionKey, ""),
          gte(metricsDaily.date, start),
          sql`${metricsDaily.date} <= ${end}`,
        ),
      )
      .groupBy(metricsDaily.platform);
  const d = (offset: number) => {
    const x = new Date(now);
    x.setUTCDate(x.getUTCDate() - offset);
    return ymd(x);
  };
  const [thisWeek, priorWeek] = await Promise.all([
    window(d(7), d(1)),
    window(d(14), d(8)),
  ]);
  const fmt = (rows: Awaited<ReturnType<typeof window>>) =>
    rows
      .map(
        (r) =>
          `- ${r.platform}: spend=${r.spend}, revenue=${r.revenue}, orders=${r.orders}, sessions=${r.sessions}, clicks=${r.clicks}, impressions=${r.impressions}, emailsSent=${r.emailsSent}, opens=${r.opens}`,
      )
      .join("\n");
  if (thisWeek.length > 0 || priorWeek.length > 0) {
    sections.push(
      `## Platform metrics — last 7 days (${d(7)}..${d(1)})\n${fmt(thisWeek) || "(none)"}\n\n## Platform metrics — prior 7 days (${d(14)}..${d(8)})\n${fmt(priorWeek) || "(none)"}`,
    );
  }

  return sections.join("\n\n");
}

export async function ingestBrand(brand: WikiBrand): Promise<{
  brand: string;
  ok: boolean;
  action: string;
  error?: string;
}> {
  try {
    const data = await gatherAggregates(brand);
    if (!data.trim()) {
      await logWikiActivity({
        brandId: brand.id,
        op: "ingest",
        action: "skipped",
        detail: "no data available for digest",
      });
      return { brand: brand.slug, ok: true, action: "skipped" };
    }

    const existing = await db.query.knowledgeDocs.findFirst({
      where: and(
        eq(knowledgeDocs.brandId, brand.id),
        eq(knowledgeDocs.kind, "wiki-page"),
        eq(knowledgeDocs.title, DIGEST_TITLE),
      ),
    });
    // Respect an admin prune: a deactivated digest stays deactivated.
    if (existing && !existing.isActive) {
      await logWikiActivity({
        brandId: brand.id,
        op: "ingest",
        action: "skipped",
        docId: existing.id,
        detail: "digest page deactivated by admin",
      });
      return { brand: brand.slug, ok: true, action: "skipped" };
    }

    const model = await resolveModel(WIKI_MODEL);
    const { object, usage } = await generateObject({
      model,
      schema: z.object({ content: z.string() }),
      system:
        `You maintain a concise weekly data digest for ${brand.name} (${brand.domain}), ` +
        `a page injected into an AI marketing assistant's context. Rewrite the ENTIRE page ` +
        `from the data below. Max 400 words, markdown with ## sections. Only facts present ` +
        `in the data — never invent or extrapolate numbers. Lead with what changed this ` +
        `week vs the prior week. Round large numbers sensibly. Omit sections with no data.` +
        (existing
          ? `\n\nPrevious week's page (for continuity; your output replaces it entirely):\n${existing.content.slice(0, 3000)}`
          : ""),
      prompt: `# Data\n\n${data}`,
    });
    await logUsage({
      kind: "task",
      model: WIKI_MODEL,
      usage,
      brandId: brand.id,
      refId: existing?.id ?? null,
    });

    let docId: string;
    let action: string;
    if (existing) {
      await db
        .update(knowledgeDocs)
        .set({
          content: object.content,
          slug: "weekly-data-digest",
          verifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(knowledgeDocs.id, existing.id));
      docId = existing.id;
      action = "updated";
    } else {
      const [row] = await db
        .insert(knowledgeDocs)
        .values({
          brandId: brand.id,
          teamId: null,
          kind: "wiki-page",
          title: DIGEST_TITLE,
          slug: "weekly-data-digest",
          content: object.content,
          isActive: true,
          verifiedAt: new Date(),
          updatedById: null,
        })
        .returning({ id: knowledgeDocs.id });
      docId = row.id;
      action = "created";
    }
    await logWikiActivity({
      brandId: brand.id,
      op: "ingest",
      action,
      docId,
      detail: `digest rewritten (${object.content.length} chars)`,
      model: WIKI_MODEL,
    });

    await regenerateWikiIndex(brand.id);
    return { brand: brand.slug, ok: true, action };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`wiki ingest failed for ${brand.slug}`, err);
    await logWikiActivity({
      brandId: brand.id,
      op: "ingest",
      action: "error",
      detail: error.slice(0, 500),
      status: "error",
      model: WIKI_MODEL,
    });
    return { brand: brand.slug, ok: false, action: "error", error };
  }
}

/** Weekly ingest across all brands (each isolated). Called from the cron. */
export async function runWeeklyIngest(): Promise<{
  ok: number;
  failed: number;
  results: Awaited<ReturnType<typeof ingestBrand>>[];
}> {
  const all = await db
    .select({
      id: brands.id,
      slug: brands.slug,
      name: brands.name,
      domain: brands.domain,
    })
    .from(brands);
  const results = [];
  for (const brand of all) {
    // ingestBrand catches its own failures, but this guard makes the isolation
    // structural rather than a promise: without it anything that escaped (an
    // error thrown while logging the error, say) would abort the loop and skip
    // every remaining brand. runWeeklyLint has always been written this way.
    try {
      results.push(await ingestBrand(brand));
    } catch (err) {
      console.error(`wiki ingest threw outside ingestBrand for ${brand.slug}`, err);
      results.push({
        brand: brand.slug,
        ok: false,
        action: "error",
        error: String(err),
      });
    }
  }
  return {
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
