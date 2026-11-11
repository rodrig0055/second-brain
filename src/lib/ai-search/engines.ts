/**
 * Asks each assistant a buyer prompt the way a shopper would, with that
 * provider's own web search on, then has a cheap model read the answer.
 *
 * These are API stand-ins for the consumer apps, not the apps themselves:
 * ChatGPT, Gemini and Claude in the browser add memory, personalisation and
 * their own system prompts. The scorecard says "observed" for what the API
 * returned, nothing more.
 */
import { Output, generateText, stepCountIs, type LanguageModelUsage, type ToolSet } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import { estimateCost, googleGroundingTools, PASS_MODELS, resolveModel } from "@/lib/models";
import { getProviderApiKey } from "@/lib/llm-keys";
import { resolveRedirect } from "@/lib/web-search";
import { domainOf, linksInText, type Platform } from "./model";

export const PLATFORM_MODELS: Record<Platform, string> = {
  chatgpt: PASS_MODELS.aiSearchChatgpt,
  gemini: PASS_MODELS.aiSearchGemini,
  claude: PASS_MODELS.aiSearchClaude,
};

/**
 * Per-call search fee estimate in USD, on top of tokens (published rates,
 * checked 2026-11: OpenAI and Anthropic $10 per 1,000 searches, Google
 * grounding $14 per 1,000 prompts). Claude may search more than once.
 */
const SEARCH_FEE: Record<Platform, number> = { chatgpt: 0.01, gemini: 0.014, claude: 0.02 };

const LOCATION = { type: "approximate" as const, country: "PH", city: "Manila", timezone: "Asia/Manila" };

export type Answer = {
  model: string;
  text: string;
  citations: { url: string; domain: string; title: string }[];
  usage: LanguageModelUsage | undefined;
  costUsd: number;
};

async function toolsFor(platform: Platform): Promise<ToolSet> {
  if (platform === "chatgpt") {
    const openai = createOpenAI({ apiKey: await getProviderApiKey("openai") });
    return { web_search: openai.tools.webSearch({ userLocation: LOCATION }) } as unknown as ToolSet;
  }
  if (platform === "claude") {
    const anthropic = createAnthropic({ apiKey: await getProviderApiKey("anthropic") });
    return {
      web_search: anthropic.tools.webSearch_20250305({ maxUses: 3, userLocation: LOCATION }),
    } as unknown as ToolSet;
  }
  return { google_search: googleGroundingTools().google_search };
}

export async function ask(platform: Platform, prompt: string): Promise<Answer> {
  const model = PLATFORM_MODELS[platform];
  const result = await generateText({
    model: await resolveModel(model),
    tools: await toolsFor(platform),
    stopWhen: stepCountIs(4),
    prompt,
    abortSignal: AbortSignal.timeout(120_000),
  });

  const fromSources = result.sources
    .filter((s): s is typeof s & { sourceType: "url"; url: string } => s.sourceType === "url")
    .map((s) => ({ url: s.url, title: s.title?.trim() ?? "" }));
  const fromText = linksInText(result.text).map((url) => ({ url, title: "" }));

  // Gemini cites through vertexaisearch redirects; the Location header is the page.
  const resolved = await Promise.all(
    [...fromSources, ...fromText].map(async (c) => ({ ...c, url: await resolveRedirect(c.url) })),
  );
  // The same page often comes back from both the sources and the text, with
  // and without "www." or a trailing slash: keep the first, which has a title.
  const seen = new Set<string>();
  const key = (url: string) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/[/#?]+$/, "").toLowerCase();
  const citations = resolved
    .map((c) => ({ ...c, domain: domainOf(c.url) }))
    .filter((c) => c.domain && !seen.has(key(c.url)) && seen.add(key(c.url)));

  const usage = result.totalUsage;
  return {
    model,
    text: result.text,
    citations,
    usage,
    costUsd:
      estimateCost(model, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0) + SEARCH_FEE[platform],
  };
}

// --- The judge ---------------------------------------------------------------

const judgeSchema = z.object({
  brands: z
    .array(
      z.object({
        name: z.string().describe("The brand or shop name as written"),
        domain: z.string().nullable().describe("Its website domain if the answer gives one, else null"),
        recommended: z.boolean().describe("True if the answer suggests the buyer use it, not just names it"),
      }),
    )
    .describe(
      "Every flower, gift or delivery shop or marketplace the answer names, in order of first appearance. Not generic nouns ('a local florist'), not payment or courier companies unless offered as the place to buy.",
    ),
  sentiment: z.enum(["positive", "neutral", "negative"]).describe("How the answer speaks about OUR brand. neutral if it is not named"),
  accuracyIssues: z
    .array(z.string().max(300))
    .describe(
      "Each claim about OUR brand that contradicts the facts given. Empty when nothing contradicts them. Never list a claim the facts do not cover.",
    ),
});

export type Judgement = z.infer<typeof judgeSchema> & { costUsd: number };

export async function judge(input: {
  prompt: string;
  answer: string;
  brandName: string;
  aliases: string[];
  facts: string;
}): Promise<Judgement> {
  const system =
    "You read an AI assistant's answer to a shopper and record, exactly, what it says. You never add brands it did not name.\n" +
    `OUR brand is ${input.brandName} (also written: ${input.aliases.join(", ")}).\n` +
    (input.facts.trim()
      ? `Facts about OUR brand, true as of today:\n${input.facts.trim()}`
      : "No facts are on file: return an empty accuracyIssues list.");
  const prompt = `Shopper's question:\n${input.prompt}\n\nAssistant's answer:\n${input.answer.slice(0, 12000)}`;

  let lastError: unknown;
  for (const id of [PASS_MODELS.aiSearchJudge, PASS_MODELS.aiSearchJudgeFallback]) {
    try {
      const { experimental_output: out, totalUsage } = await generateText({
        model: await resolveModel(id),
        system,
        prompt,
        experimental_output: Output.object({ schema: judgeSchema }),
        abortSignal: AbortSignal.timeout(60_000),
      });
      return {
        ...out,
        accuracyIssues: input.facts.trim() ? out.accuracyIssues : [],
        costUsd: estimateCost(id, totalUsage?.inputTokens ?? 0, totalUsage?.outputTokens ?? 0),
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
