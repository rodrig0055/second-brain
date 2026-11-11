/**
 * The AI search tracker's vocabulary and the roadmap arithmetic: priority,
 * blocks, cycle phases and the re-test decision. Pure, no db, so the pages,
 * the actions, the cron and the tests all read the same rules.
 *
 * Method: the Evidence-Sorted Roadmap (Similarweb, "AI search optimization
 * roadmap"). Track 30-50 buyer prompts, label each gap with one of the ten
 * readiness traits, sort fixes by evidence tier then impact / effort, build in
 * two 30-day blocks inside a 90-day cycle, re-test on day 76.
 */
export { SEO_TEAM_SLUG as AI_SEARCH_TEAM_SLUG } from "@/lib/workspaces";

/** Acme Florals first. The tables are brand-scoped, so another brand is a seed away. */
export const AI_SEARCH_BRAND_SLUG = "acme-florals";
export const AI_SEARCH_TZ = "Asia/Manila";

export const PLATFORMS = ["chatgpt", "gemini", "claude"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABELS: Record<Platform, string> = {
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  claude: "Claude",
};
export const isPlatform = (v: unknown): v is Platform => PLATFORMS.includes(v as Platform);

export const STAGES = ["awareness", "consideration", "decision"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  awareness: "Awareness",
  consideration: "Consideration",
  decision: "Decision",
};
export const isStage = (v: unknown): v is Stage => STAGES.includes(v as Stage);

/**
 * Prompt language. "tl" covers Tagalog and Taglish: real chat Taglish keeps
 * words like "flowers" and "same day delivery" in English.
 */
export const LANGUAGES = ["en", "tl"] as const;
export type Language = (typeof LANGUAGES)[number];
export const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  tl: "Tagalog / Taglish",
};
export const isLanguage = (v: unknown): v is Language => LANGUAGES.includes(v as Language);

/** Aleyda Solis's ten AI search readiness traits: every gap gets exactly one. */
export const READINESS = [
  "accessible",
  "extractable",
  "useful",
  "fresh",
  "differentiated",
  "recognizable",
  "consistent",
  "corroborated",
  "credible",
  "transactable",
] as const;
export type Readiness = (typeof READINESS)[number];
export const READINESS_HINTS: Record<Readiness, string> = {
  accessible: "AI crawlers can fetch and render the page",
  extractable: "Key facts are in the HTML, easy to lift out",
  useful: "The page answers the question the buyer asked",
  fresh: "Prices, dates and stock are current",
  differentiated: "Says something competitors do not",
  recognizable: "The brand is a known entity for the topic",
  consistent: "Same facts on our site, feeds and listings",
  corroborated: "Third-party sites back up what we say",
  credible: "Reviews, authorship, proof",
  transactable: "The buyer can act: price, delivery, checkout",
};
export const isReadiness = (v: unknown): v is Readiness => READINESS.includes(v as Readiness);

/**
 * Evidence tiers. "Skip" (buying, trading or faking mentions) is not a tier
 * here: it is never an action, so the board does not offer it.
 */
export const TIERS = ["do", "only_if", "good_to_have", "parked"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABELS: Record<Tier, string> = {
  do: "Do",
  only_if: "Only if cheap",
  good_to_have: "Good to have",
  parked: "Parked",
};
export const TIER_HINTS: Record<Tier, string> = {
  do: "Proven: titles and openers that match the question, coverage on third-party sites AI cites, crawlable pages with key facts in HTML",
  only_if: "When cheap: sourced statistics, answer-first openers, visible dates and refreshes, author or summary boxes",
  good_to_have: "No proven citation lift: FAQ blocks, schema, heading structure, llms.txt, chunking",
  parked: "No clear next step yet; kept on the monitoring list",
};
export const isTier = (v: unknown): v is Tier => TIERS.includes(v as Tier);
const TIER_RANK: Record<Tier, number> = { do: 0, only_if: 1, good_to_have: 2, parked: 3 };

export const ACTION_STATUSES = ["planned", "in_progress", "shipped"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
};
export const isActionStatus = (v: unknown): v is ActionStatus => ACTION_STATUSES.includes(v as ActionStatus);

export const DECISIONS = ["keep", "expand", "revise", "stop"] as const;
export type Decision = (typeof DECISIONS)[number];
export const DECISION_LABELS: Record<Decision, string> = {
  keep: "Keep",
  expand: "Expand",
  revise: "Revise",
  stop: "Stop",
};
export const isDecision = (v: unknown): v is Decision => DECISIONS.includes(v as Decision);

export const clampScore = (n: number): number => Math.min(3, Math.max(1, Math.round(n) || 2));

/** Impact / effort, both 1-3. */
export function priority(impact: number, effort: number): number {
  return clampScore(impact) / clampScore(effort);
}

/**
 * Which build block an action belongs in. A proven ("Do") action with the
 * highest effort starts in block 1 whatever its score, because third-party
 * coverage has long lead times; otherwise anything worth at least its effort
 * goes first.
 */
export function suggestedBlock(tier: Tier, impact: number, effort: number): 1 | 2 {
  if (tier === "do" && clampScore(effort) === 3) return 1;
  return priority(impact, effort) >= 1 ? 1 : 2;
}

/** Board order: block, then tier, then priority, then title. */
export function compareActions(
  a: { block: number; tier: Tier; impact: number; effort: number; title: string },
  b: { block: number; tier: Tier; impact: number; effort: number; title: string },
): number {
  return (
    a.block - b.block ||
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    priority(b.impact, b.effort) - priority(a.impact, a.effort) ||
    a.title.localeCompare(b.title)
  );
}

// --- Cycle calendar -------------------------------------------------------

export const CYCLE_DAYS = 90;
/** Day 76 is the re-test: the start of the last 15 days. */
export const RETEST_DAY = 76;

export type Phase = "planning" | "block1" | "block2" | "retest" | "done";
export const PHASE_LABELS: Record<Phase, string> = {
  planning: "Planning",
  block1: "Build block 1",
  block2: "Build block 2",
  retest: "Re-test",
  done: "Cycle over",
};

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysYmd(ymd: string, n: number): string {
  return new Date(ymdToUtc(ymd) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 1-based day of the cycle (day 1 = start). */
export function cycleDay(startOn: string, today: string): number {
  return Math.round((ymdToUtc(today) - ymdToUtc(startOn)) / 86_400_000) + 1;
}

export function phaseOf(day: number): Phase {
  if (day <= 15) return "planning";
  if (day <= 45) return "block1";
  if (day <= 75) return "block2";
  if (day <= CYCLE_DAYS) return "retest";
  return "done";
}

export function cycleCalendar(startOn: string) {
  return {
    planning: { from: startOn, to: addDaysYmd(startOn, 14) },
    block1: { from: addDaysYmd(startOn, 15), to: addDaysYmd(startOn, 44) },
    block2: { from: addDaysYmd(startOn, 45), to: addDaysYmd(startOn, 74) },
    retest: { from: addDaysYmd(startOn, RETEST_DAY - 1), to: addDaysYmd(startOn, CYCLE_DAYS - 1) },
  };
}

export function defaultRetestOn(startOn: string): string {
  return addDaysYmd(startOn, RETEST_DAY - 1);
}

/**
 * The re-test call for one action, from its topic's visibility before the
 * build (baseline) and at the re-test, net of the same change on topics no
 * action touched (the control). Modeled, not observed: it is a suggestion
 * for the owner, who records the decision.
 */
export function suggestDecision(
  lift: number | null,
): { decision: Decision; why: string } | null {
  if (lift === null || !Number.isFinite(lift)) return null;
  const pts = Math.round(lift * 100);
  if (lift >= 0.15) return { decision: "expand", why: `+${pts} pts over control: roll it out to more pages or topics` };
  if (lift >= 0.05) return { decision: "keep", why: `+${pts} pts over control: keep it running` };
  if (lift > -0.05) return { decision: "revise", why: `${pts >= 0 ? "+" : ""}${pts} pts over control: no clear effect, change the approach` };
  return { decision: "stop", why: `${pts} pts against control: stop and free the owner` };
}

// --- Matching "us" in an answer --------------------------------------------

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** True when `host` is one of `domains` or a subdomain of one. */
export function isOwnDomain(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return domains.some((d) => {
    const dd = d.toLowerCase().replace(/^www\./, "");
    return dd !== "" && (h === dd || h.endsWith(`.${dd}`));
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether the answer names us. Aliases match as whole words, case-insensitive,
 * so "Acme Florals" matches but a generic "a flower store near you" does not
 * (that is why "flower store" is never an alias).
 */
export function mentionsBrand(answer: string, aliases: string[], domains: string[]): boolean {
  const names = [...aliases, ...domains].map((n) => n.trim()).filter(Boolean);
  return names.some((n) => new RegExp(`(^|[^\\w.])${escapeRe(n)}(?![\\w])`, "i").test(answer));
}

/** Links written into the answer text itself: markdown links and bare URLs. */
export function linksInText(answer: string): string[] {
  const out = new Set<string>();
  for (const m of answer.matchAll(/https?:\/\/[^\s)\]>"'`]+/g)) out.add(m[0].replace(/[.,;:]+$/, ""));
  return [...out];
}

/**
 * Brand names normalised for counting: case, spacing, punctuation, a trailing
 * domain suffix and a trailing "PH" ignored, so "Acme Florals",
 * "Flower Store PH" and "acmeflorals" are one brand.
 */
export function normaliseBrand(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\.(com|ph|net|org|co)(\.ph)?$/, "")
    .replace(/[^a-z0-9]+/g, "")
    .replace(/(.{3,})ph$/, "$1");
}
