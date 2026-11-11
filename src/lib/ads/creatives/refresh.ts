import "server-only";

import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { adCreatives, integrationRecords } from "@/db/schema";
import {
  fetchAdsByIds,
  resolveMetaTarget,
  type NormalizedCreative,
} from "@/lib/integrations/meta/client";
import { classifyCreative, CLASSIFY_MODEL } from "@/lib/integrations/meta/classify";
import { durableCreativeMedia } from "@/lib/ads/creatives/media";
import type { DbConnection } from "@/lib/integrations/types";

/**
 * Keeping the creative cache honest.
 *
 * `ad_creatives` was only ever written when someone pressed "Analyze
 * creatives", which left two things quietly broken: the status column on the
 * pivot was empty, and the failed-to-run rule (which asks whether an ad that
 * should be delivering is) could never fire, because it reads a status that was
 * never refreshed. Both work off a nightly pass now.
 *
 * Classification stays separate and budgeted: a full-video pass through Gemini
 * is slow and costs money, so it takes the top unclassified ads by recency and
 * stops when its time is up. It is resumable by design — the next run picks up
 * where this one stopped.
 */

const ID_BATCH = 50;

/** Ad ids this account has spent on recently, plus everything we think is live. */
async function adIdsToRefresh(conn: DbConnection, sinceDays: number): Promise<string[]> {
  const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);

  const [recent, live] = await Promise.all([
    db
      .selectDistinct({ externalId: integrationRecords.externalId })
      .from(integrationRecords)
      .where(
        and(
          eq(integrationRecords.connectionId, conn.id),
          eq(integrationRecords.recordType, "ad_insight"),
          gte(integrationRecords.periodStart, since),
        ),
      ),
    db
      .select({ adId: adCreatives.adId })
      .from(adCreatives)
      .where(
        and(
          eq(adCreatives.connectionId, conn.id),
          inArray(adCreatives.effectiveStatus, ["ACTIVE", "PENDING_REVIEW", "IN_PROCESS"]),
        ),
      ),
  ]);

  // ad_insight external ids are "<adId>:<date>".
  const ids = new Set<string>();
  for (const row of recent) {
    const id = row.externalId.split(":")[0];
    if (id) ids.add(id);
  }
  for (const row of live) ids.add(row.adId);
  return [...ids];
}

function baseValues(conn: DbConnection, c: NormalizedCreative) {
  return {
    connectionId: conn.id,
    brandId: conn.brandId,
    platform: "meta" as const,
    adId: c.adId,
    adName: c.adName,
    campaignId: c.campaignId,
    campaignName: c.campaignName,
    objective: c.objective,
    effectiveStatus: c.effectiveStatus,
    configuredStatus: c.configuredStatus,
    adsetId: c.adsetId,
    adsetName: c.adsetName,
    metaCreatedAt: c.createdTime ? new Date(c.createdTime) : null,
    mediaType: c.mediaType,
    imageUrl: c.imageUrl,
    thumbnailUrl: c.thumbnailUrl,
    videoId: c.videoId,
    body: c.body,
    title: c.title,
    callToAction: c.callToAction,
    lastStatusAt: new Date(),
    updatedAt: new Date(),
  };
}

export type RefreshResult = { refreshed: number; inserted: number; missing: number };

/**
 * Pull current status and structure for this account's ads.
 *
 * Only ever writes the facts Meta owns. The AI label columns are untouched, so
 * a refresh can run every night without undoing a classification or a person's
 * accepted funnel.
 */
export async function refreshCreativeStatus(
  conn: DbConnection,
  opts: { sinceDays?: number } = {},
): Promise<RefreshResult> {
  const target = resolveMetaTarget(conn);
  const ids = await adIdsToRefresh(conn, opts.sinceDays ?? 30);
  if (ids.length === 0) return { refreshed: 0, inserted: 0, missing: 0 };

  const existing = await db
    .select({
      adId: adCreatives.adId,
      imageUrl: adCreatives.imageUrl,
      thumbnailUrl: adCreatives.thumbnailUrl,
    })
    .from(adCreatives)
    .where(and(eq(adCreatives.connectionId, conn.id), inArray(adCreatives.adId, ids)));
  const known = new Map(existing.map((r) => [r.adId, r]));

  let refreshed = 0;
  let inserted = 0;
  const seen = new Set<string>();

  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const creatives = await fetchAdsByIds(target, ids.slice(i, i + ID_BATCH)).catch((err) => {
      // Logged, not thrown: one bad batch should not stop the rest. But it
      // must be visible, because swallowing it silently is how this pass went
      // a month without writing anything.
      console.error(`[ads-creatives] fetch failed for ${conn.id}:`, err);
      return [] as NormalizedCreative[];
    });
    for (const c of creatives) {
      seen.add(c.adId);
      const values = {
        ...baseValues(conn, c),
        ...(await durableCreativeMedia(conn.id, c.adId, c, known.get(c.adId))),
      };
      await db
        .insert(adCreatives)
        .values(values)
        .onConflictDoUpdate({
          target: [adCreatives.connectionId, adCreatives.adId],
          // Deliberately partial: nothing here touches aiAssetType,
          // messagingAngle, hookTactic, funnelStage, confidence or rationale.
          set: {
            adName: values.adName,
            campaignId: values.campaignId,
            campaignName: values.campaignName,
            objective: values.objective,
            effectiveStatus: values.effectiveStatus,
            configuredStatus: values.configuredStatus,
            adsetId: values.adsetId,
            adsetName: values.adsetName,
            metaCreatedAt: values.metaCreatedAt,
            mediaType: values.mediaType,
            imageUrl: values.imageUrl,
            thumbnailUrl: values.thumbnailUrl,
            videoId: values.videoId,
            body: values.body,
            title: values.title,
            callToAction: values.callToAction,
            lastStatusAt: values.lastStatusAt,
            updatedAt: values.updatedAt,
          },
        });
      if (known.has(c.adId)) refreshed += 1;
      else inserted += 1;
    }
  }

  // An ad Meta stopped returning is probably deleted, but one bad response is
  // not a deletion, so it only becomes UNKNOWN after a week of not appearing.
  const gone = ids.filter((id) => !seen.has(id) && known.has(id));
  if (gone.length) {
    await db
      .update(adCreatives)
      .set({ effectiveStatus: "UNKNOWN", updatedAt: new Date() })
      .where(
        and(
          eq(adCreatives.connectionId, conn.id),
          inArray(adCreatives.adId, gone),
          sql`${adCreatives.lastStatusAt} < now() - interval '7 days'`,
        ),
      );
  }

  return { refreshed, inserted, missing: gone.length };
}

export type ClassifyResult = { classified: number; failed: number; remaining: number };

/**
 * Classify what has not been classified, within a budget.
 *
 * Bounded by both a count and a deadline because a full-video pass through
 * Gemini is slow and the cron has 300 seconds for every account. Whatever is
 * left is left; the next run takes the next batch.
 */
export async function classifyPending(
  conn: DbConnection,
  opts: { max?: number; deadlineMs?: number; concurrency?: number } = {},
): Promise<ClassifyResult> {
  const max = opts.max ?? 20;
  const deadline = opts.deadlineMs ?? Date.now() + 240_000;
  const concurrency = opts.concurrency ?? 3;

  const pending = await db
    .select({ adId: adCreatives.adId })
    .from(adCreatives)
    .where(and(eq(adCreatives.connectionId, conn.id), isNull(adCreatives.classifiedAt)))
    // Newest first: a creative running now is worth more than one from March.
    .orderBy(sql`${adCreatives.metaCreatedAt} DESC NULLS LAST`)
    .limit(max);

  const [{ n: remainingBefore } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adCreatives)
    .where(and(eq(adCreatives.connectionId, conn.id), isNull(adCreatives.classifiedAt)));

  if (pending.length === 0) return { classified: 0, failed: 0, remaining: 0 };

  const target = resolveMetaTarget(conn);
  const creatives = await fetchAdsByIds(
    target,
    pending.map((p) => p.adId),
  ).catch(() => [] as NormalizedCreative[]);

  let classified = 0;
  let failed = 0;

  for (let i = 0; i < creatives.length; i += concurrency) {
    if (Date.now() > deadline) break;
    const batch = creatives.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (creative) => {
        try {
          const { classification } = await classifyCreative(creative, target, {
            userId: null,
            brandId: conn.brandId,
            teamId: null,
          });
          await upsertClassification(conn, creative, classification);
          classified += 1;
        } catch {
          failed += 1;
        }
      }),
    );
  }

  return { classified, failed, remaining: Math.max(0, remainingBefore - classified) };
}

/** Write a classification onto a creative, creating the row if it is new. */
export async function upsertClassification(
  conn: DbConnection,
  creative: NormalizedCreative,
  classification: {
    assetType: string;
    messagingAngle: string;
    hookTactic: string;
    funnelStage: string;
    confidence: number;
    rationale: string;
  },
): Promise<void> {
  const labels = {
    aiAssetType: classification.assetType,
    messagingAngle: classification.messagingAngle,
    hookTactic: classification.hookTactic,
    funnelStage: classification.funnelStage,
    confidence: classification.confidence.toFixed(2),
    rationale: classification.rationale,
    classification,
    classifyModel: CLASSIFY_MODEL,
    classifiedAt: new Date(),
  };
  const [current] = await db
    .select({ imageUrl: adCreatives.imageUrl, thumbnailUrl: adCreatives.thumbnailUrl })
    .from(adCreatives)
    .where(and(eq(adCreatives.connectionId, conn.id), eq(adCreatives.adId, creative.adId)));
  const media = await durableCreativeMedia(conn.id, creative.adId, creative, current);
  const values = { ...baseValues(conn, creative), ...media, ...labels };

  await db
    .insert(adCreatives)
    .values(values)
    .onConflictDoUpdate({
      target: [adCreatives.connectionId, adCreatives.adId],
      set: { ...values, connectionId: undefined, brandId: undefined, adId: undefined },
    });
}
