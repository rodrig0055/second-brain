import type { LanguageModelUsage } from "ai";
import { db } from "@/db";
import { usageEvents } from "@/db/schema";
import type { ImageUsage } from "@/lib/image-models";
import { estimateImageCost } from "@/lib/image-pricing";
import { estimateCost } from "@/lib/models";

type UsageContext = {
  userId?: string | null;
  brandId?: string | null;
  teamId?: string | null;
  refId?: string | null;
};

type LogUsageArgs = UsageContext & {
  kind: "chat" | "task";
  model: string;
  /**
   * Pass the WHOLE call's usage: `totalUsage` for multi-step (tool-calling)
   * calls. `usage` on a streamText/generateText result is the last step only.
   */
  usage: LanguageModelUsage | undefined;
};

/**
 * Record token usage + estimated cost for one LLM call. Never throws — a
 * logging failure must not break the response stream that triggered it.
 */
export async function logUsage({
  kind,
  model,
  usage,
  userId,
  brandId,
  teamId,
  refId,
}: LogUsageArgs): Promise<void> {
  try {
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    // Prompt-cache accounting: the AI SDK reports read/write components of the
    // input across all providers under inputTokenDetails. cacheReadTokens are
    // served from cache (steep discount); cacheWriteTokens created the cache
    // this turn (Anthropic charges a small premium). Both are subsets of
    // inputTokens, so estimateCost prices only the remainder at the base rate.
    const cacheReadTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage?.inputTokenDetails?.cacheWriteTokens ?? 0;
    await db.insert(usageEvents).values({
      kind,
      model,
      userId: userId ?? null,
      brandId: brandId ?? null,
      teamId: teamId ?? null,
      refId: refId ?? null,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd: estimateCost(
        model,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
      ).toFixed(6),
    });
  } catch (err) {
    console.error("logUsage failed", err);
  }
}

/**
 * Record one image generation (one model x format x variant). Never throws,
 * like logUsage: a logging failure must not lose an image the user paid for.
 */
export async function logImageUsage({
  model,
  usage,
  userId,
  brandId,
  teamId,
  refId,
}: UsageContext & { model: string; usage: ImageUsage }): Promise<void> {
  try {
    await db.insert(usageEvents).values({
      kind: "image",
      model,
      userId: userId ?? null,
      brandId: brandId ?? null,
      teamId: teamId ?? null,
      refId: refId ?? null,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costUsd: estimateImageCost(
        model,
        usage.inputTokens,
        usage.outputTokens,
        usage.imageInputTokens,
      ).toFixed(6),
    });
    // SVG output: the text model that wrote the vector bills separately, at
    // its own text rates. Same kind and refId, so the run's total adds up.
    if (usage.author) {
      await db.insert(usageEvents).values({
        kind: "image",
        model: usage.author.model,
        userId: userId ?? null,
        brandId: brandId ?? null,
        teamId: teamId ?? null,
        refId: refId ?? null,
        inputTokens: usage.author.inputTokens,
        outputTokens: usage.author.outputTokens,
        costUsd: estimateCost(
          usage.author.model,
          usage.author.inputTokens,
          usage.author.outputTokens,
        ).toFixed(6),
      });
    }
  } catch (err) {
    console.error("logImageUsage failed", err);
  }
}
