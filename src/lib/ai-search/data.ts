/**
 * Read model for the AI search pages. Scoring itself is in score.ts (pure).
 */
import { and, asc, desc, eq, gte, isNull } from "drizzle-orm";

import { db } from "@/db";
import { aiSearchActions, aiSearchCycles, aiSearchPrompts, aiSearchRuns, users } from "@/db/schema";
import { isLanguage, isPlatform, isStage, type Platform, type Stage } from "./model";
import type { ScoredRun } from "./score";

export type PromptRow = typeof aiSearchPrompts.$inferSelect;
export type RunRow = typeof aiSearchRuns.$inferSelect;
export type CycleRow = typeof aiSearchCycles.$inferSelect;
export type ActionRow = typeof aiSearchActions.$inferSelect & { ownerName: string };

export async function loadPrompts(brandId: string): Promise<PromptRow[]> {
  return db.query.aiSearchPrompts.findMany({
    where: eq(aiSearchPrompts.brandId, brandId),
    orderBy: [asc(aiSearchPrompts.topic), asc(aiSearchPrompts.createdAt)],
  });
}

/**
 * Good answers since `from`, joined to their prompt's topic and stage. Only
 * prompts tracked now: a paused prompt's past answers would otherwise mix an
 * old prompt set into today's rates.
 */
export async function loadScoredRuns(brandId: string, from: string): Promise<ScoredRun[]> {
  const rows = await db
    .select({
      promptId: aiSearchRuns.promptId,
      platform: aiSearchRuns.platform,
      runOn: aiSearchRuns.runOn,
      topic: aiSearchPrompts.topic,
      stage: aiSearchPrompts.stage,
      language: aiSearchPrompts.language,
      appeared: aiSearchRuns.appeared,
      recommended: aiSearchRuns.recommended,
      cited: aiSearchRuns.cited,
      position: aiSearchRuns.position,
      brands: aiSearchRuns.brands,
      citations: aiSearchRuns.citations,
      accuracyIssues: aiSearchRuns.accuracyIssues,
    })
    .from(aiSearchRuns)
    .innerJoin(aiSearchPrompts, eq(aiSearchPrompts.id, aiSearchRuns.promptId))
    .where(
      and(
        eq(aiSearchRuns.brandId, brandId),
        gte(aiSearchRuns.runOn, from),
        isNull(aiSearchRuns.error),
        eq(aiSearchPrompts.active, true),
      ),
    );
  return rows
    .filter((r): r is typeof r & { platform: Platform; stage: Stage } => isPlatform(r.platform) && isStage(r.stage))
    .map((r) => ({ ...r, language: isLanguage(r.language) ? r.language : "en" }));
}

/** Most recent run per (prompt, assistant), failed or not: the prompt table's cells. */
export async function loadLatestRuns(brandId: string, from: string): Promise<Map<string, RunRow>> {
  const rows = await db.query.aiSearchRuns.findMany({
    where: and(eq(aiSearchRuns.brandId, brandId), gte(aiSearchRuns.runOn, from)),
    orderBy: desc(aiSearchRuns.runOn),
  });
  const out = new Map<string, RunRow>();
  for (const r of rows) {
    const k = `${r.promptId}:${r.platform}`;
    if (!out.has(k)) out.set(k, r);
  }
  return out;
}

export async function loadPromptRuns(promptId: string, limit = 60): Promise<RunRow[]> {
  return db.query.aiSearchRuns.findMany({
    where: eq(aiSearchRuns.promptId, promptId),
    orderBy: [desc(aiSearchRuns.runOn), asc(aiSearchRuns.platform)],
    limit,
  });
}

/** Failed calls in the window on prompts tracked now, by assistant: the outage banner. */
export async function loadFailures(brandId: string, from: string): Promise<{ platform: string; count: number; last: string }[]> {
  const rows = await db
    .select({ platform: aiSearchRuns.platform, error: aiSearchRuns.error })
    .from(aiSearchRuns)
    .innerJoin(aiSearchPrompts, eq(aiSearchPrompts.id, aiSearchRuns.promptId))
    .where(and(eq(aiSearchRuns.brandId, brandId), gte(aiSearchRuns.runOn, from), eq(aiSearchPrompts.active, true)));
  const out = new Map<string, { count: number; last: string }>();
  for (const r of rows) {
    if (!r.error) continue;
    const e = out.get(r.platform);
    if (e) e.count++;
    else out.set(r.platform, { count: 1, last: r.error });
  }
  return [...out.entries()].map(([platform, v]) => ({ platform, ...v }));
}

export async function loadCycles(brandId: string): Promise<CycleRow[]> {
  return db.query.aiSearchCycles.findMany({
    where: eq(aiSearchCycles.brandId, brandId),
    orderBy: desc(aiSearchCycles.number),
  });
}

export async function loadActions(cycleId: string): Promise<ActionRow[]> {
  const rows = await db
    .select({ a: aiSearchActions, name: users.name, email: users.email })
    .from(aiSearchActions)
    .leftJoin(users, eq(users.id, aiSearchActions.ownerId))
    .where(eq(aiSearchActions.cycleId, cycleId));
  return rows.map((r) => ({ ...r.a, ownerName: r.name || r.email?.split("@")[0] || "" }));
}

export async function loadOwners(): Promise<{ id: string; label: string }[]> {
  const rows = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).orderBy(users.email);
  return rows.map((u) => ({ id: u.id, label: u.name || u.email.split("@")[0] }));
}
