/**
 * Keeping `ad_entities` level with the account.
 *
 * Separate from `sync.ts`, which walks `/insights` day by day and appends
 * metrics. This replaces a mirror: there is one current configuration and the
 * only interesting question about it is whether ours matches.
 *
 * Runs all three levels because they are read together. An ad set's budget is
 * meaningless without knowing whether its campaign carries the budget instead,
 * and an ad's effective status is mostly its parents'.
 */
import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { adEntities } from "@/db/schema";
import type { DbConnection } from "@/lib/integrations/types";
import { accountIdOf, resolveMetaTarget } from "./client";
import { fetchEntities, type EntityLevel, type NormalizedEntity } from "./entities";
import { syncedLevels } from "./entity-sync-levels";

/**
 * Campaigns and ad sets only. See `entities.ts`: ad rows carried none of the
 * configuration this mirror exists for, and were 83% of its volume.
 */
const LEVELS: EntityLevel[] = syncedLevels();

export type EntitySyncResult = {
  adAccountId: string;
  counts: Record<EntityLevel, number>;
  written: number;
  /** Entities we hold that the account no longer returns. */
  vanished: number;
  changed: string[];
  /** Levels where the page cap stopped the walk before the account ran out. */
  truncated: EntityLevel[];
};

/**
 * Pull every campaign, ad set and ad, and write what changed.
 *
 * Returns the entities whose configuration moved since the last run, which is
 * the part worth alerting on: a budget that changed overnight is the answer to
 * most "why did this spend differently" questions.
 */
export async function syncMetaEntities(
  conn: DbConnection,
): Promise<EntitySyncResult> {
  const target = resolveMetaTarget(conn);
  const currency = String(conn.config?.currency ?? "");
  const counts = { campaign: 0, adset: 0, ad: 0 } as Record<EntityLevel, number>;
  // `ad` stays in the shape at zero: callers read it, and a missing key would
  // read as an error rather than as a level nobody syncs.

  const before = await db
    .select({
      level: adEntities.level,
      entityId: adEntities.entityId,
      status: adEntities.status,
      dailyBudgetMinor: adEntities.dailyBudgetMinor,
      lifetimeBudgetMinor: adEntities.lifetimeBudgetMinor,
      targetingHash: adEntities.targetingHash,
    })
    .from(adEntities)
    .where(eq(adEntities.connectionId, conn.id));

  const priorByKey = new Map(
    before.map((row) => [`${row.level}:${row.entityId}`, row]),
  );

  const seen = new Set<string>();
  const changed: string[] = [];
  const truncated: EntityLevel[] = [];
  let written = 0;

  for (const level of LEVELS) {
    const { entities, truncated: hitCap } = await fetchEntities(target, level);
    if (hitCap) truncated.push(level);
    counts[level] = entities.length;

    for (const entity of entities) {
      const key = `${level}:${entity.entityId}`;
      seen.add(key);
      const prior = priorByKey.get(key);
      if (prior && moved(prior, entity)) changed.push(key);
    }
    written += await upsertMany(conn, entities, currency);
  }

  // Deleted in Ads Manager, or outside whatever the edges now return. The row
  // stays, because it still explains history; only the stamp tells the truth
  // about how current it is.
  const vanished = before.filter(
    (row) => !seen.has(`${row.level}:${row.entityId}`),
  ).length;

  return {
    adAccountId: accountIdOf(conn),
    counts,
    written,
    vanished,
    changed,
    truncated,
  };
}

/** Whether anything a proposal would care about differs. */
function moved(
  prior: {
    status: string;
    dailyBudgetMinor: string | null;
    lifetimeBudgetMinor: string | null;
    targetingHash: string;
  },
  next: NormalizedEntity,
): boolean {
  return (
    prior.status !== next.status ||
    prior.dailyBudgetMinor !== next.dailyBudgetMinor ||
    prior.lifetimeBudgetMinor !== next.lifetimeBudgetMinor ||
    prior.targetingHash !== next.targetingHash
  );
}

/**
 * Write a level's worth of entities in as few round trips as possible.
 *
 * One statement per entity was the obvious shape and the wrong one. This
 * account has 1,710 ads, and a sequential upsert each costs a round trip to
 * Neon: the first real run took minutes, inside a sync that Vercel kills at
 * 300 seconds. Chunked multi-row upserts turn thousands of round trips into
 * a handful.
 *
 * The chunk size is bounded by parameters rather than rows: Postgres allows
 * 65,535 per statement and each row here carries 25 columns.
 */
async function upsertMany(
  conn: DbConnection,
  entities: NormalizedEntity[],
  currency: string,
): Promise<number> {
  if (entities.length === 0) return 0;
  const CHUNK = 500;
  const now = new Date();
  let written = 0;

  for (let i = 0; i < entities.length; i += CHUNK) {
    const rows = entities.slice(i, i + CHUNK).map((entity) => ({
      connectionId: conn.id,
      brandId: conn.brandId,
      currency,
      fetchedAt: now,
      ...entity,
    }));

    await db
      .insert(adEntities)
      .values(rows)
      .onConflictDoUpdate({
        target: [adEntities.connectionId, adEntities.level, adEntities.entityId],
        set: {
          name: sql`excluded.name`,
          status: sql`excluded.status`,
          effectiveStatus: sql`excluded.effective_status`,
          campaignId: sql`excluded.campaign_id`,
          adSetId: sql`excluded.ad_set_id`,
          objective: sql`excluded.objective`,
          buyingType: sql`excluded.buying_type`,
          bidStrategy: sql`excluded.bid_strategy`,
          billingEvent: sql`excluded.billing_event`,
          optimizationGoal: sql`excluded.optimization_goal`,
          dailyBudgetMinor: sql`excluded.daily_budget_minor`,
          lifetimeBudgetMinor: sql`excluded.lifetime_budget_minor`,
          budgetRemainingMinor: sql`excluded.budget_remaining_minor`,
          bidAmountMinor: sql`excluded.bid_amount_minor`,
          currency: sql`excluded.currency`,
          targeting: sql`excluded.targeting`,
          targetingHash: sql`excluded.targeting_hash`,
          promotedObject: sql`excluded.promoted_object`,
          startTime: sql`excluded.start_time`,
          stopTime: sql`excluded.stop_time`,
          metaCreatedAt: sql`excluded.meta_created_at`,
          metaUpdatedAt: sql`excluded.meta_updated_at`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
    written += rows.length;
  }
  return written;
}

/** The stored configuration for one entity, or null if we have never seen it. */
export async function loadEntity(
  connectionId: string,
  level: EntityLevel,
  entityId: string,
): Promise<typeof adEntities.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(adEntities)
    .where(
      and(
        eq(adEntities.connectionId, connectionId),
        eq(adEntities.level, level),
        eq(adEntities.entityId, entityId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Stored configuration for many entities at once, keyed by id. */
export async function loadEntities(
  connectionId: string,
  level: EntityLevel,
  entityIds: string[],
): Promise<Map<string, typeof adEntities.$inferSelect>> {
  if (entityIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(adEntities)
    .where(
      and(
        eq(adEntities.connectionId, connectionId),
        eq(adEntities.level, level),
        inArray(adEntities.entityId, entityIds),
      ),
    );
  return new Map(rows.map((row) => [row.entityId, row]));
}

/** How stale this connection's mirror is, in minutes. Null if never synced. */
export async function entityFreshness(
  connectionId: string,
): Promise<number | null> {
  const [row] = await db
    .select({ newest: sql<Date | null>`max(${adEntities.fetchedAt})` })
    .from(adEntities)
    .where(eq(adEntities.connectionId, connectionId));
  if (!row?.newest) return null;
  return Math.round((Date.now() - new Date(row.newest).getTime()) / 60_000);
}
