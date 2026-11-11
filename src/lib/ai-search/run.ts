/**
 * Runs the tracked prompts: which (prompt, assistant) pairs are due today, and
 * one run of each. Idempotent per (prompt, assistant, Manila day): a re-run the
 * same day overwrites, a failed call is stored with its error and retried by
 * the next cron pass, and a provider out of credit leaves a gap rather than a
 * zero.
 */
import { and, asc, eq, isNotNull, isNull, max } from "drizzle-orm";

import { db } from "@/db";
import { aiSearchPrompts, aiSearchRuns, aiSearchSettings, brands } from "@/db/schema";
import { todayIn } from "@/lib/date-range";
import { ask, judge } from "./engines";
import {
  AI_SEARCH_TZ,
  addDaysYmd,
  isOwnDomain,
  isPlatform,
  mentionsBrand,
  normaliseBrand,
  type Platform,
} from "./model";

export type Settings = typeof aiSearchSettings.$inferSelect;
type Prompt = typeof aiSearchPrompts.$inferSelect;
type Brand = typeof brands.$inferSelect;

export function aiSearchToday(): string {
  return todayIn(AI_SEARCH_TZ);
}

export async function loadSettings(brand: Brand): Promise<Settings> {
  const found = await db.query.aiSearchSettings.findFirst({ where: eq(aiSearchSettings.brandId, brand.id) });
  if (found) return found;
  const [row] = await db
    .insert(aiSearchSettings)
    .values({ brandId: brand.id, domains: brand.domain ? [brand.domain] : [], aliases: [] })
    .onConflictDoNothing()
    .returning();
  return row ?? (await db.query.aiSearchSettings.findFirst({ where: eq(aiSearchSettings.brandId, brand.id) }))!;
}

export function enabledPlatforms(settings: Settings): Platform[] {
  return settings.platforms.filter(isPlatform);
}

/** Where we sit in the judge's brand list, 1-based, or null. */
function ownPosition(brandsNamed: { name: string; domain: string | null }[], settings: Settings, brandName: string): number | null {
  const own = new Set([brandName, ...settings.aliases, ...settings.domains].map(normaliseBrand).filter(Boolean));
  const i = brandsNamed.findIndex(
    (b) => own.has(normaliseBrand(b.name)) || (b.domain ? isOwnDomain(b.domain, settings.domains) : false),
  );
  return i === -1 ? null : i + 1;
}

export async function runOne(
  brand: Brand,
  settings: Settings,
  prompt: Prompt,
  platform: Platform,
  runOn: string,
): Promise<{ ok: boolean; error?: string }> {
  const key = { promptId: prompt.id, brandId: brand.id, platform, runOn };
  let values: typeof aiSearchRuns.$inferInsert;
  try {
    const answer = await ask(platform, prompt.text);
    const cited = answer.citations.some((c) => isOwnDomain(c.domain, settings.domains));
    let judged: Awaited<ReturnType<typeof judge>> | null = null;
    let judgeError: string | null = null;
    try {
      judged = await judge({
        prompt: prompt.text,
        answer: answer.text,
        brandName: brand.name,
        aliases: [...settings.aliases, ...settings.domains],
        facts: settings.facts,
      });
    } catch (err) {
      judgeError = err instanceof Error ? err.message.slice(0, 500) : String(err);
    }
    const position = judged ? ownPosition(judged.brands, settings, brand.name) : null;
    const appeared = mentionsBrand(answer.text, settings.aliases, settings.domains) || position !== null;
    values = {
      ...key,
      model: answer.model,
      answer: answer.text,
      appeared,
      recommended: appeared && position !== null && judged!.brands[position - 1].recommended,
      cited,
      position,
      brands: judged?.brands ?? [],
      citations: answer.citations,
      accuracyIssues: appeared && judged && settings.facts.trim() ? judged.accuracyIssues : null,
      sentiment: appeared ? (judged?.sentiment ?? null) : null,
      judgeError,
      error: null,
      costUsd: answer.costUsd + (judged?.costUsd ?? 0),
    };
  } catch (err) {
    values = {
      ...key,
      model: "",
      error: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
    };
  }

  const { promptId: _p, brandId: _b, platform: _pl, runOn: _r, ...update } = values;
  void _p; void _b; void _pl; void _r;
  await db
    .insert(aiSearchRuns)
    .values(values)
    .onConflictDoUpdate(
      values.error
        ? {
            // A failure never overwrites a good answer from earlier the same day.
            target: [aiSearchRuns.promptId, aiSearchRuns.platform, aiSearchRuns.runOn],
            set: { error: values.error, createdAt: new Date() },
            setWhere: isNotNull(aiSearchRuns.error),
          }
        : {
            target: [aiSearchRuns.promptId, aiSearchRuns.platform, aiSearchRuns.runOn],
            set: { ...update, createdAt: new Date() },
          },
    );
  return values.error ? { ok: false, error: values.error } : { ok: true };
}

/** (prompt, assistant) pairs with no good answer within the cadence. */
export async function duePairs(
  brandId: string,
  settings: Settings,
  today: string,
): Promise<{ prompt: Prompt; platform: Platform }[]> {
  const [prompts, last] = await Promise.all([
    db.query.aiSearchPrompts.findMany({
      where: and(eq(aiSearchPrompts.brandId, brandId), eq(aiSearchPrompts.active, true)),
      orderBy: asc(aiSearchPrompts.createdAt),
    }),
    db
      .select({ promptId: aiSearchRuns.promptId, platform: aiSearchRuns.platform, lastOn: max(aiSearchRuns.runOn) })
      .from(aiSearchRuns)
      .where(and(eq(aiSearchRuns.brandId, brandId), isNull(aiSearchRuns.error)))
      .groupBy(aiSearchRuns.promptId, aiSearchRuns.platform),
  ]);
  const lastOn = new Map(last.map((l) => [`${l.promptId}:${l.platform}`, l.lastOn ?? ""]));
  const cadence = Math.max(1, settings.cadenceDays);
  const out: { prompt: Prompt; platform: Platform }[] = [];
  for (const platform of enabledPlatforms(settings)) {
    for (const prompt of prompts) {
      const prev = lastOn.get(`${prompt.id}:${platform}`);
      if (!prev || addDaysYmd(prev, cadence) <= today) out.push({ prompt, platform });
    }
  }
  return out;
}

/**
 * Works through what is due until the time budget is spent, a few calls at a
 * time. Interleaves assistants so one slow or broken provider cannot starve
 * the others; the cron calls this several times a morning to finish the set.
 */
export async function runDue(
  brand: Brand,
  { budgetMs = 240_000, concurrency = 6 }: { budgetMs?: number; concurrency?: number } = {},
) {
  const started = Date.now();
  const settings = await loadSettings(brand);
  const today = aiSearchToday();
  const due = await duePairs(brand.id, settings, today);
  // Round-robin by prompt index so each pass covers every assistant.
  due.sort((a, b) => a.prompt.createdAt.getTime() - b.prompt.createdAt.getTime() || a.platform.localeCompare(b.platform));

  let next = 0;
  let ok = 0;
  const errors: string[] = [];
  async function worker() {
    while (next < due.length && Date.now() - started < budgetMs) {
      const { prompt, platform } = due[next++];
      const r = await runOne(brand, settings, prompt, platform, today);
      if (r.ok) ok++;
      else errors.push(`${platform}: ${r.error}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { due: due.length, ok, failed: errors.length, left: Math.max(0, due.length - next), errors: [...new Set(errors)].slice(0, 5) };
}
