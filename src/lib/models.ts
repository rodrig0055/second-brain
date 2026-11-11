import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  createGoogleGenerativeAI,
  google,
  type GoogleInteractionsAgentName,
} from "@ai-sdk/google";
import type { ToolSet } from "ai";
import {
  getCustomModel,
  getProviderApiKey,
  listCustomModelOptions,
} from "@/lib/llm-keys";

/**
 * How a model refresh decides what replaces what. A successor must share the
 * provider, `family` and `tier` of the model it replaces: a cheaper model from
 * another tier or family is a quality decision for a person, never a swap.
 * `stage: "preview"` models stay selectable but are never pinned as a default
 * or a background-pass model below.
 */
export type ModelTier = "frontier" | "balanced" | "cheap" | "research";
export type ModelStage = "ga" | "preview";

// Text models selectable per task template / skill. Each template names its
// own model; DEFAULT_CHAT_MODEL is the overall fallback (used by chat and by
// any template without an explicit model). Direct provider keys — no gateway.
// The first entry is what the template editor preselects for a new template,
// so keep it the same model as DEFAULT_CHAT_MODEL.
export const MODEL_OPTIONS = [
  { id: "google/gemini-3.8-flash", label: "Gemini 3.8 Flash — default, balanced", family: "gemini-flash", tier: "balanced", stage: "ga" },
  { id: "google/gemini-3.6-flash", label: "Gemini 3.6 Flash — newest, balanced", family: "gemini-flash", tier: "balanced", stage: "ga" },
  { id: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash — most intelligent", family: "gemini-flash", tier: "balanced", stage: "ga" },
  { id: "google/gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite — fast/cheap", family: "gemini-flash-lite", tier: "cheap", stage: "ga" },
  { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro", family: "gemini-pro", tier: "frontier", stage: "preview" },
  {
    id: "google/deep-research-max-preview-04-2026",
    label: "Gemini Deep Research (Max) — long-running, cited reports",
    family: "gemini-deep-research",
    tier: "research",
    stage: "preview",
  },
  { id: "anthropic/claude-fable-5-1", label: "Claude Fable 5.1 (deepest reasoning)", family: "claude-fable", tier: "frontier", stage: "ga" },
  { id: "anthropic/claude-opus-5", label: "Claude Opus 5 (best all-round)", family: "claude-opus", tier: "frontier", stage: "ga" },
  { id: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5 (fast, balanced)", family: "claude-sonnet", tier: "balanced", stage: "ga" },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5 (fastest/cheapest)", family: "claude-haiku", tier: "cheap", stage: "ga" },
  { id: "openai/gpt-5.6-sol", label: "GPT-5.6 Sol — frontier, deepest", family: "gpt", tier: "frontier", stage: "ga" },
  { id: "openai/gpt-6.1-sol", label: "GPT-6.1 Sol — balanced", family: "gpt", tier: "balanced", stage: "ga" },
  { id: "openai/gpt-6-luna", label: "GPT-6 Luna — cost-optimized", family: "gpt", tier: "cheap", stage: "ga" },
  { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini — fast/cheap", family: "gpt-mini", tier: "cheap", stage: "ga" },
  { id: "openai/gpt-5.4-nano", label: "GPT-5.4 nano — cheapest", family: "gpt-nano", tier: "cheap", stage: "ga" },
] as const satisfies readonly {
  id: string;
  label: string;
  family: string;
  tier: ModelTier;
  stage: ModelStage;
}[];

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

export const DEFAULT_CHAT_MODEL: ModelId = "google/gemini-3.8-flash";

/**
 * The model each background pass runs on. No user picks these, so they live
 * here, named by job, and a model refresh edits this block rather than hunting
 * through the passes. Typed as ModelId so dropping a model from MODEL_OPTIONS
 * fails the build instead of leaving a pass on an id nobody maintains.
 */
export const PASS_MODELS = {
  /** Open-loop capture, hypothesis planning and the weekly roll-up. */
  loops: "google/gemini-3.5-flash",
  /** Loop validation: runs the research pulls and writes the verdict. */
  loopValidate: "google/gemini-3.6-flash",
  /** Weekly proposals into the admin inbox. */
  propose: "google/gemini-3.5-flash",
  /** Review gate on customer-facing template output. */
  review: "google/gemini-3.5-flash",
  /** Wiki reflect / ingest / lint: distill and summarize work. */
  wiki: "google/gemini-3.5-flash-lite",
  /** Meta creative classification. Must take video input, so Gemini only. */
  metaClassify: "google/gemini-3.5-flash",
  /** Custom-song lyric respelling when the order carries no model of its own. */
  respellFallback: "google/gemini-3.6-flash",
  /** Marketing Review: first-draft answers to the monthly agenda. */
  reviewDraft: "google/gemini-3.6-flash",
  /** Partnerships: a first draft of the next email to a partner. Shares the review draft fallbacks. */
  partnerDraft: "google/gemini-3.6-flash",
  /** Image studio: reads a brief to pick GPT Image 2.6 planning and detail. */
  imageSettings: "google/gemini-3.5-flash-lite",
  /** Its fallback on another provider; if both fail the studio uses rules. */
  imageSettingsFallback: "openai/gpt-6-luna",
  /** Its fallbacks on other providers, for when one is out of credit or keyless. */
  reviewDraftFallback: "openai/gpt-6.1-sol",
  reviewDraftFallback2: "anthropic/claude-sonnet-5",
  /**
   * AI search tracker: the model standing in for each consumer assistant. Each
   * is that provider's balanced default, the tier a free user gets, with its
   * own web search on.
   */
  aiSearchChatgpt: "openai/gpt-6.1-sol",
  aiSearchGemini: "google/gemini-3.8-flash",
  aiSearchClaude: "anthropic/claude-sonnet-5",
  /** Reads each answer: brands named, whether we are recommended, fact errors. */
  aiSearchJudge: "google/gemini-3.5-flash-lite",
  aiSearchJudgeFallback: "openai/gpt-6-luna",
} as const satisfies Record<string, ModelId>;

/**
 * Same-tier successors for ids that are no longer in MODEL_OPTIONS. The daily
 * sync cron (see remapRetiredModels in src/lib/model-remap.ts) repoints stored
 * config rows through this map, so a model swap only has to edit this file.
 * Keep retired ids in MODEL_PRICING too: history still carries them.
 */
export const RETIRED_MODEL_SUCCESSORS: Record<string, ModelId> = {
  "google/gemini-3.1-flash-lite": "google/gemini-3.5-flash-lite",
  "openai/gpt-5.5-pro": "openai/gpt-5.6-sol",
  "anthropic/claude-sonnet-4-6": "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-4-8": "anthropic/claude-opus-5",
  "anthropic/claude-opus-4-7": "anthropic/claude-opus-5",
  "openai/gpt-5.6-luna": "openai/gpt-6-luna",
  "openai/gpt-5.6-terra": "openai/gpt-6.1-sol",
};

// USD per 1M tokens, {in, out}. Used to estimate cost for the usage dashboard.
// Update alongside MODEL_OPTIONS. Unknown models fall back to the default.
// NOTE: the Anthropic, OpenAI and Gemini prices are the published first-party
// standard rates (checked 2026-10-01). Gemini 3.8 and 3.6 Flash are on a launch price
// until 2026-12-31 ($1.50/$7.50 from 2027-01-01) and GPT-5.6 Sol on a
// promotional one through at least 2026-11-21. The deep research price is
// approximate (Google bills it at the underlying Gemini rates). They only
// affect the /admin/usage cost estimate.
export const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  "google/gemini-3.8-flash": { in: 0.75, out: 3.75 },
  "google/gemini-3.6-flash": { in: 0.75, out: 3.75 },
  "google/gemini-3.5-flash": { in: 1.5, out: 9 },
  "google/gemini-3.5-flash-lite": { in: 0.3, out: 2.5 },
  "google/gemini-3.1-pro-preview": { in: 2, out: 12 },
  "google/deep-research-max-preview-04-2026": { in: 2, out: 12 },
  "anthropic/claude-fable-5-1": { in: 10, out: 50 },
  "anthropic/claude-opus-5": { in: 5, out: 25 },
  "anthropic/claude-sonnet-5": { in: 2, out: 10 },
  "anthropic/claude-haiku-4-5": { in: 1, out: 5 },
  "openai/gpt-5.6-sol": { in: 4, out: 20 },
  "openai/gpt-6.1-sol": { in: 2, out: 10 },
  "openai/gpt-6-luna": { in: 0.1, out: 0.5 },
  "openai/gpt-5.4-mini": { in: 0.75, out: 4.5 },
  "openai/gpt-5.4-nano": { in: 0.2, out: 1.25 },
  // Retired ids kept for pricing only: no longer selectable, but old runs and
  // conversations still carry them and the usage dashboard prices history.
  "anthropic/claude-sonnet-4-6": { in: 3, out: 15 },
  "anthropic/claude-opus-4-8": { in: 5, out: 25 },
  "anthropic/claude-opus-4-7": { in: 5, out: 25 },
  "openai/gpt-5.6-luna": { in: 0.2, out: 1.2 },
  "openai/gpt-5.6-terra": { in: 2, out: 12 },
};

// Cache pricing as a fraction of the base input price, per provider. Cache
// reads are heavily discounted; Anthropic also charges a write premium on the
// turn that creates the cache. OpenAI/Google reads are automatic; Anthropic
// reads are the cheapest. Unknown providers assume a conservative 0.25x read.
const CACHE_READ_MULT: Record<string, number> = {
  anthropic: 0.1,
  openai: 0.1,
  google: 0.25,
};
const CACHE_WRITE_MULT: Record<string, number> = { anthropic: 1.25 };

/**
 * Estimated USD cost for a single call. Cache-aware: `cacheReadTokens` and
 * `cacheWriteTokens` are the cached-read / cache-creation components of
 * `inputTokens` (from `usage.inputTokenDetails`), priced at their provider
 * multipliers; the rest of the input bills at the base rate.
 */
export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0,
): number {
  const price = MODEL_PRICING[model] ?? MODEL_PRICING[DEFAULT_CHAT_MODEL];
  const provider = providerOf(model);
  const readMult = CACHE_READ_MULT[provider] ?? 0.25;
  const writeMult = CACHE_WRITE_MULT[provider] ?? 1;
  const uncachedInput = Math.max(
    0,
    inputTokens - cacheReadTokens - cacheWriteTokens,
  );
  return (
    (uncachedInput / 1_000_000) * price.in +
    (cacheReadTokens / 1_000_000) * price.in * readMult +
    (cacheWriteTokens / 1_000_000) * price.in * writeMult +
    (outputTokens / 1_000_000) * price.out
  );
}

/**
 * The provider slug of a "provider/model" id (the part before the first "/").
 * `resolveModel` returns an opaque AI SDK model instance that hides its
 * provider, so callers that need provider-specific behavior — notably
 * Anthropic's explicit `cacheControl` breakpoints (OpenAI and Google cache
 * automatically) — recover it from the id string via this helper.
 */
export function providerOf(id: string): string {
  return id.split("/")[0] ?? "";
}

/** The model/agent name of a "provider/model" id (everything after the slug). */
function modelName(id: string): string {
  return id.split("/").slice(1).join("/");
}

// Google Deep Research agents run on the long-running Interactions API
// (/v1beta/interactions), not generateContent. They do their own multi-source
// web research and emit cited reports, so they take minutes and get NO extra
// grounding tools attached.
const GOOGLE_DEEP_RESEARCH_AGENTS = new Set<string>([
  "deep-research-max-preview-04-2026",
  "deep-research-preview-04-2026",
  "deep-research-pro-preview-12-2025",
]);

/** Whether an id selects a Google Deep Research agent (Interactions API). */
export function isDeepResearchModel(id: string): boolean {
  return (
    providerOf(id) === "google" && GOOGLE_DEEP_RESEARCH_AGENTS.has(modelName(id))
  );
}

/**
 * Google server-side grounding tools: Search grounding + URL context. These are
 * provider tool *declarations* (no API key needed) and only work on Gemini
 * generateContent models — attach them only when `providerOf(id) === "google"`
 * and `!isDeepResearchModel(id)`. The record keys MUST be `google_search` /
 * `url_context` (the provider's required tool names).
 */
export function googleGroundingTools(): ToolSet {
  // Cast: provider-defined tools type `inputSchema` as `{}`, which the nominal
  // ToolSet index signature (expecting Tool<never, never>) rejects even though
  // they are valid Tool instances — a known AI SDK generic-variance quirk. The
  // cast just satisfies ToolSet so call sites can merge them cleanly.
  return {
    google_search: google.tools.googleSearch({}),
    url_context: google.tools.urlContext({}),
  } as unknown as ToolSet;
}

/**
 * Resolves a "provider/model" id to an AI SDK model instance, wiring in the
 * provider's API key (admin-supplied key from the DB, else the env var). Async
 * because the key may live in the DB.
 */
export async function resolveModel(id: string) {
  const [provider, ...rest] = id.split("/");
  const name = rest.join("/");
  if (provider === "openai" && name) {
    return createOpenAI({ apiKey: await getProviderApiKey("openai") })(name);
  }
  if (provider === "anthropic" && name) {
    return createAnthropic({ apiKey: await getProviderApiKey("anthropic") })(
      name,
    );
  }
  if (provider === "google" && name) {
    const g = createGoogleGenerativeAI({
      apiKey: await getProviderApiKey("google"),
    });
    // Deep Research agents use the Interactions API. `.interactions(...)` still
    // returns a LanguageModelV3, so generateText/streamText drive it normally —
    // just expect minutes-long runs and cited-report output.
    if (GOOGLE_DEEP_RESEARCH_AGENTS.has(name)) {
      return g.interactions({ agent: name as GoogleInteractionsAgentName });
    }
    return g(name);
  }
  // Anything else is treated as a custom OpenAI-compatible provider registered
  // by an admin, keyed by its slug (the part before the first "/").
  if (provider) {
    const custom = await getCustomModel(provider);
    if (custom) {
      return createOpenAI({
        apiKey: custom.apiKey,
        baseURL: custom.baseUrl,
      })(custom.modelName);
    }
  }
  return createAnthropic({ apiKey: await getProviderApiKey("anthropic") })(
    "claude-opus-5",
  );
}

/**
 * Built-in models plus any admin-registered custom models, for the template
 * editor's model picker. Async because custom models live in the DB.
 */
export async function getModelOptions(): Promise<
  { id: string; label: string }[]
> {
  const custom = await listCustomModelOptions();
  return [...MODEL_OPTIONS, ...custom];
}

/** Whether a model id is selectable (built-in or a registered custom model). */
export async function isValidModelId(id: string): Promise<boolean> {
  if (MODEL_OPTIONS.some((o) => o.id === id)) return true;
  const slug = id.split("/")[0];
  return slug ? (await getCustomModel(slug)) !== null : false;
}
