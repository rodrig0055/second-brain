"use server";

import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";

import { db } from "@/db";
import { aiSearchActions, aiSearchCycles, aiSearchPrompts, aiSearchSettings } from "@/db/schema";
import { isYmd } from "@/lib/date-range";
import { aiSearchPath, requireAiSearchTeam } from "@/lib/ai-search/gate";
import {
  PLATFORMS,
  clampScore,
  defaultRetestOn,
  isActionStatus,
  isDecision,
  isLanguage,
  isPlatform,
  isReadiness,
  isStage,
  isTier,
  suggestedBlock,
} from "@/lib/ai-search/model";
import { aiSearchToday, enabledPlatforms, loadSettings, runOne } from "@/lib/ai-search/run";

/**
 * Every action re-authorises from scratch: the team slug is a form field, so
 * it is client supplied. Each one also checks the row it touches belongs to
 * the tracker's brand.
 */
async function authorize(formData: FormData) {
  return requireAiSearchTeam(String(formData.get("teamSlug") ?? ""));
}

function str(formData: FormData, key: string, max = 255): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

function refresh() {
  revalidatePath(aiSearchPath(), "layout");
}

async function ownPrompt(brandId: string, id: string) {
  if (!isUuid(id)) return null;
  return (
    (await db.query.aiSearchPrompts.findFirst({
      where: and(eq(aiSearchPrompts.id, id), eq(aiSearchPrompts.brandId, brandId)),
    })) ?? null
  );
}

async function ownAction(brandId: string, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select({ action: aiSearchActions, cycle: aiSearchCycles })
    .from(aiSearchActions)
    .innerJoin(aiSearchCycles, eq(aiSearchCycles.id, aiSearchActions.cycleId))
    .where(and(eq(aiSearchActions.id, id), eq(aiSearchCycles.brandId, brandId)));
  return row ?? null;
}

async function validOwner(raw: string): Promise<string | null> {
  if (!isUuid(raw)) return null;
  const u = await db.query.users.findFirst({ where: (u, { eq: is }) => is(u.id, raw), columns: { id: true } });
  return u?.id ?? null;
}

// --- Prompts -----------------------------------------------------------------

export async function addPrompts(formData: FormData) {
  const { brand } = await authorize(formData);
  const stage = str(formData, "stage");
  const topic = str(formData, "topic", 60).toLowerCase();
  const rawLanguage = str(formData, "language");
  const language = isLanguage(rawLanguage) ? rawLanguage : "en";
  if (!isStage(stage) || !topic) return;
  // One prompt per line, so a batch pastes in at once.
  const lines = str(formData, "text", 8000)
    .split("\n")
    .map((l) => l.trim().slice(0, 500))
    .filter(Boolean);
  if (lines.length === 0) return;
  await db
    .insert(aiSearchPrompts)
    .values(lines.map((text) => ({ brandId: brand.id, text, stage, topic, language })))
    .onConflictDoNothing();
  refresh();
}

export async function updatePrompt(formData: FormData) {
  const { brand } = await authorize(formData);
  const prompt = await ownPrompt(brand.id, str(formData, "promptId", 64));
  if (!prompt) return;
  const stage = str(formData, "stage");
  const topic = str(formData, "topic", 60).toLowerCase();
  const language = str(formData, "language");
  await db
    .update(aiSearchPrompts)
    .set({
      stage: isStage(stage) ? stage : prompt.stage,
      language: isLanguage(language) ? language : prompt.language,
      topic: topic || prompt.topic,
      active: formData.has("active") ? formData.get("active") === "on" : prompt.active,
    })
    .where(eq(aiSearchPrompts.id, prompt.id));
  refresh();
}

export async function togglePrompt(formData: FormData) {
  const { brand } = await authorize(formData);
  const prompt = await ownPrompt(brand.id, str(formData, "promptId", 64));
  if (!prompt) return;
  await db.update(aiSearchPrompts).set({ active: !prompt.active }).where(eq(aiSearchPrompts.id, prompt.id));
  refresh();
}

/** Asks every enabled assistant now. Replaces today's answers for this prompt. */
export async function runPromptNow(formData: FormData) {
  const { brand } = await authorize(formData);
  const prompt = await ownPrompt(brand.id, str(formData, "promptId", 64));
  if (!prompt) return;
  const settings = await loadSettings(brand);
  const today = aiSearchToday();
  await Promise.all(enabledPlatforms(settings).map((p) => runOne(brand, settings, prompt, p, today)));
  refresh();
}

// --- Settings ----------------------------------------------------------------

export async function saveSettings(formData: FormData) {
  const { brand } = await authorize(formData);
  await loadSettings(brand);
  const list = (key: string) =>
    [...new Set(str(formData, key, 2000).split(/[\n,]/).map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const cadence = Number(str(formData, "cadenceDays", 3));
  const platforms = PLATFORMS.filter((p) => formData.get(`platform_${p}`) === "on");
  await db
    .update(aiSearchSettings)
    .set({
      aliases: list("aliases").filter((a) => a !== "flower store"),
      domains: list("domains").map((d) => d.replace(/^https?:\/\//, "").replace(/\/.*$/, "")),
      facts: str(formData, "facts", 8000),
      cadenceDays: Number.isInteger(cadence) && cadence >= 1 && cadence <= 30 ? cadence : 1,
      platforms: platforms.filter(isPlatform),
      updatedAt: new Date(),
    })
    .where(eq(aiSearchSettings.brandId, brand.id));
  refresh();
}

// --- Cycles and actions --------------------------------------------------------

export async function startCycle(formData: FormData) {
  const { brand } = await authorize(formData);
  const startOn = str(formData, "startOn", 10);
  if (!isYmd(startOn)) return;
  const [{ n }] = await db
    .select({ n: max(aiSearchCycles.number) })
    .from(aiSearchCycles)
    .where(eq(aiSearchCycles.brandId, brand.id));
  await db.insert(aiSearchCycles).values({
    brandId: brand.id,
    number: (n ?? 0) + 1,
    startOn,
    notes: str(formData, "notes", 4000),
  });
  refresh();
}

function readScores(formData: FormData) {
  const tier = str(formData, "tier");
  const readiness = str(formData, "readiness");
  return {
    tier: isTier(tier) ? tier : null,
    readiness: isReadiness(readiness) ? readiness : null,
    impact: clampScore(Number(str(formData, "impact", 2))),
    effort: clampScore(Number(str(formData, "effort", 2))),
  };
}

export async function createAction(formData: FormData) {
  const { brand } = await authorize(formData);
  const cycleId = str(formData, "cycleId", 64);
  const cycle = isUuid(cycleId)
    ? await db.query.aiSearchCycles.findFirst({
        where: and(eq(aiSearchCycles.id, cycleId), eq(aiSearchCycles.brandId, brand.id)),
      })
    : null;
  const title = str(formData, "title", 300);
  const { tier, readiness, impact, effort } = readScores(formData);
  if (!cycle || !title || !tier || !readiness) return;
  const retest = str(formData, "retestOn", 10);
  await db.insert(aiSearchActions).values({
    cycleId: cycle.id,
    title,
    hypothesis: str(formData, "hypothesis", 2000),
    topic: str(formData, "topic", 60).toLowerCase(),
    readiness,
    tier,
    impact,
    effort,
    block: suggestedBlock(tier, impact, effort),
    ownerId: await validOwner(str(formData, "ownerId", 64)),
    kpi: str(formData, "kpi", 300),
    retestOn: isYmd(retest) ? retest : defaultRetestOn(cycle.startOn),
  });
  refresh();
}

export async function updateAction(formData: FormData) {
  const { brand } = await authorize(formData);
  const found = await ownAction(brand.id, str(formData, "actionId", 64));
  if (!found) return;
  const a = found.action;
  const { tier, readiness, impact, effort } = readScores(formData);
  const status = str(formData, "status");
  const decision = str(formData, "decision");
  const block = Number(str(formData, "block", 1));
  const retest = str(formData, "retestOn", 10);
  const has = (k: string) => formData.has(k);
  await db
    .update(aiSearchActions)
    .set({
      title: has("title") ? str(formData, "title", 300) || a.title : a.title,
      hypothesis: has("hypothesis") ? str(formData, "hypothesis", 2000) : a.hypothesis,
      topic: has("topic") ? str(formData, "topic", 60).toLowerCase() : a.topic,
      kpi: has("kpi") ? str(formData, "kpi", 300) : a.kpi,
      notes: has("notes") ? str(formData, "notes", 4000) : a.notes,
      tier: tier ?? a.tier,
      readiness: readiness ?? a.readiness,
      impact: has("impact") ? impact : a.impact,
      effort: has("effort") ? effort : a.effort,
      block: block === 1 || block === 2 ? block : a.block,
      status: isActionStatus(status) ? status : a.status,
      decision: has("decision") ? (isDecision(decision) ? decision : null) : a.decision,
      ownerId: has("ownerId") ? await validOwner(str(formData, "ownerId", 64)) : a.ownerId,
      retestOn: isYmd(retest) ? retest : a.retestOn,
      updatedAt: new Date(),
    })
    .where(eq(aiSearchActions.id, a.id));
  refresh();
}

export async function deleteAction(formData: FormData) {
  const { brand } = await authorize(formData);
  const found = await ownAction(brand.id, str(formData, "actionId", 64));
  if (!found) return;
  await db.delete(aiSearchActions).where(eq(aiSearchActions.id, found.action.id));
  refresh();
}
