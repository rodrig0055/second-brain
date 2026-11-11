import { db } from "@/db";
import { decryptSecret } from "@/lib/crypto";

export type LlmProvider = "anthropic" | "openai" | "google";

export const LLM_PROVIDERS: {
  id: LlmProvider;
  label: string;
  envVar: string;
  keyPlaceholder: string;
}[] = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    envVar: "ANTHROPIC_API_KEY",
    keyPlaceholder: "sk-ant-…",
  },
  {
    id: "openai",
    label: "OpenAI (GPT, GPT Image)",
    envVar: "OPENAI_API_KEY",
    keyPlaceholder: "sk-…",
  },
  {
    id: "google",
    label: "Google (Gemini)",
    envVar: "GOOGLE_GENERATIVE_AI_API_KEY",
    keyPlaceholder: "AIza…",
  },
];

const ENV_VAR: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
};

// Cache decrypted keys for the lifetime of a single request batch. Cleared
// implicitly per serverless invocation; resolveModel reads keys on every call.
let cache: Partial<Record<LlmProvider, string | null>> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 30_000;

async function loadKeys(): Promise<Partial<Record<LlmProvider, string>>> {
  const rows = await db.query.llmProviderKeys.findMany();
  const out: Partial<Record<LlmProvider, string>> = {};
  for (const row of rows) {
    try {
      out[row.provider] = decryptSecret(row.encryptedKey);
    } catch {
      // A bad key (e.g. enc key rotated) shouldn't crash requests; fall through
      // to the env var instead.
    }
  }
  return out;
}

/**
 * Returns the API key for a provider: the admin-supplied DB key if present,
 * otherwise the build-time env var (which may be undefined). Results are cached
 * briefly so hot chat/task paths don't hit the DB on every model resolution.
 */
export async function getProviderApiKey(
  provider: LlmProvider,
): Promise<string | undefined> {
  const now = Date.now();
  if (!cache || now - cacheLoadedAt > CACHE_TTL_MS) {
    cache = await loadKeys();
    cacheLoadedAt = now;
  }
  return cache[provider] ?? process.env[ENV_VAR[provider]] ?? undefined;
}

/** Drop the cached keys (call after saving/removing a key in the UI). */
export function invalidateProviderKeyCache(): void {
  cache = null;
  customCache = null;
}

/**
 * Resolved config for a custom OpenAI-compatible model, looked up by its slug
 * (the provider segment of a `<slug>/<modelName>` id). Returns null if the slug
 * is unknown or its key can't be decrypted. Briefly cached alongside the keys.
 */
let customCache: Map<string, {
  baseUrl: string;
  modelName: string;
  apiKey: string;
}> | null = null;
let customCacheLoadedAt = 0;

export async function getCustomModel(slug: string): Promise<{
  baseUrl: string;
  modelName: string;
  apiKey: string;
} | null> {
  const now = Date.now();
  if (!customCache || now - customCacheLoadedAt > CACHE_TTL_MS) {
    const rows = await db.query.customLlmModels.findMany();
    const map = new Map<
      string,
      { baseUrl: string; modelName: string; apiKey: string }
    >();
    for (const row of rows) {
      try {
        map.set(row.slug, {
          baseUrl: row.baseUrl,
          modelName: row.modelName,
          apiKey: decryptSecret(row.encryptedKey),
        });
      } catch {
        // bad key (e.g. enc key rotated) — skip; resolveModel will fall back.
      }
    }
    customCache = map;
    customCacheLoadedAt = now;
  }
  return customCache.get(slug) ?? null;
}

/** Model options ({id,label}) for every registered custom model. */
export async function listCustomModelOptions(): Promise<
  { id: string; label: string }[]
> {
  const rows = await db.query.customLlmModels.findMany({
    columns: { slug: true, modelName: true, label: true },
  });
  return rows.map((r) => ({
    id: `${r.slug}/${r.modelName}`,
    label: r.label,
  }));
}

/** Status for each provider, for the admin UI. Never returns the key itself. */
export async function listProviderKeyStatus(): Promise<
  {
    provider: LlmProvider;
    hasDbKey: boolean;
    hasEnvKey: boolean;
    hint: string;
    updatedAt: Date | null;
  }[]
> {
  const rows = await db.query.llmProviderKeys.findMany();
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return LLM_PROVIDERS.map(({ id }) => {
    const row = byProvider.get(id);
    return {
      provider: id,
      hasDbKey: Boolean(row),
      hasEnvKey: Boolean(process.env[ENV_VAR[id]]),
      hint: row?.hint ?? "",
      updatedAt: row?.updatedAt ?? null,
    };
  });
}
