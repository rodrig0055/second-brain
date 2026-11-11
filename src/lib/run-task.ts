import { generateText, stepCountIs } from "ai";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taskRuns, taskTemplates } from "@/db/schema";
import {
  googleGroundingTools,
  isDeepResearchModel,
  providerOf,
  resolveModel,
} from "@/lib/models";
import { buildSystemPrompt, fillTemplate } from "@/lib/prompt";
import { fetchPageContext, urlInputs } from "@/lib/fetch-page";
import { buildSeoTools } from "@/lib/tools";
import { buildBrainTools } from "@/lib/tools/brain-tools";
import { logUsage } from "@/lib/usage";
import {
  MAX_REVIEW_ROUNDS,
  reviewDraft,
  revisionInstructions,
  type ReviewResult,
} from "@/lib/review/review";
import { hasCapability } from "@/lib/workspaces";

type RunTaskArgs = {
  templateId: string;
  brandId: string;
  inputs: Record<string, string>;
  userId?: string | null;
};

/**
 * Run a task template to completion (non-streaming) and persist a taskRun.
 * Shared by the cron / scheduled-task path; the interactive route streams
 * its own response. Mirrors the assembly in /api/tasks/run.
 */
export async function runTaskOnce({
  templateId,
  brandId,
  inputs,
  userId,
}: RunTaskArgs): Promise<string | null> {
  const template = await db.query.taskTemplates.findFirst({
    where: eq(taskTemplates.id, templateId),
    with: { team: true },
  });
  if (!template || !template.isActive) return null;

  const cleanInputs: Record<string, string> = {};
  for (const field of template.inputFields) {
    cleanInputs[field.name] = (inputs?.[field.name] ?? "").slice(0, 8000);
  }

  const [run] = await db
    .insert(taskRuns)
    .values({
      templateId: template.id,
      userId: userId ?? template.createdById!,
      brandId,
      inputs: cleanInputs,
      model: template.model,
      status: "running",
    })
    .returning();

  try {
    const system = await buildSystemPrompt(brandId, template.teamId);
    let prompt = fillTemplate(template.promptTemplate, cleanInputs);

    const urls = urlInputs(cleanInputs).slice(0, 2);
    if (urls.length > 0) {
      const fetched = await Promise.all(urls.map(fetchPageContext));
      const blocks = urls
        .map((u, i) =>
          fetched[i] ? `# Fetched content from ${u}\n${fetched[i]}` : null,
        )
        .filter(Boolean);
      if (blocks.length > 0) prompt += `\n\n---\n\n${blocks.join("\n\n")}`;
    }


    const brand = await db.query.brands.findFirst({
      where: (b, { eq: e }) => e(b.id, brandId),
    });
    // Mirror /api/tasks/run: SEO templates get the SEO data tools, and every
    // brand additionally gets the live "brain" tools for whatever integrations
    // it has connected (Shopify, Meta, Google Ads, …). Text-only if none.
    const seoTools =
      brand && hasCapability(template.team.slug, "seoTools") ? buildSeoTools(brand) : {};
    const brainTools = brand
      ? await buildBrainTools(brand, template.team.slug)
      : {};
    // Gemini generateContent models also get Google's grounding tools (Search
    // grounding + URL context); not for deep-research agents / other providers.
    const grounding =
      providerOf(template.model) === "google" &&
      !isDeepResearchModel(template.model)
        ? googleGroundingTools()
        : {};
    const tools = { ...seoTools, ...brainTools, ...grounding };
    const hasTools = Object.keys(tools).length > 0;

    const model = await resolveModel(template.model);
    /** One generation attempt. `extra` carries the reviewer's revision notes. */
    const generate = (extra?: string) => {
      const userPrompt = extra ? `${prompt}\n\n---\n\n${extra}` : prompt;
      return generateText({
        model,
        // Anthropic: system prompt as a leading system message so an Anthropic
        // cache_control breakpoint can ride on it; allowSystemInMessages silences
        // AI SDK's injection warning (trusted, server-assembled prompt). Other
        // providers keep the plain system/prompt options and cache automatically.
        ...(providerOf(template.model) === "anthropic"
          ? {
              allowSystemInMessages: true,
              messages: [
                {
                  role: "system" as const,
                  content: system,
                  providerOptions: {
                    anthropic: { cacheControl: { type: "ephemeral" } },
                  },
                },
                { role: "user" as const, content: userPrompt },
              ],
            }
          : { system, prompt: userPrompt }),
        tools: hasTools ? tools : undefined,
        stopWhen: hasTools ? stepCountIs(8) : undefined,
      });
    };

    const first = await generate();
    let text = first.text;
    await logUsage({
      kind: "task",
      model: template.model,
      usage: first.totalUsage,
      userId: run.userId,
      brandId,
      teamId: template.teamId,
      refId: run.id,
    });

    // The review gate. This path is non-streaming, so nothing has been delivered
    // yet and a failed review can still be acted on — one regeneration, then
    // stop. Looping further chases diminishing returns and can trade one flagged
    // line for another; a human reads the receipt instead.
    let review: ReviewResult | null = null;
    if (template.reviewGate) {
      review = await reviewDraft({
        draft: text,
        task: prompt,
        brandId,
        teamId: template.teamId,
        userId: run.userId,
        refId: run.id,
      });

      if (review.verdict === "revise") {
        const retry = await generate(revisionInstructions(review));
        await logUsage({
          kind: "task",
          model: template.model,
          usage: retry.totalUsage,
          userId: run.userId,
          brandId,
          teamId: template.teamId,
          refId: run.id,
        });
        const second = await reviewDraft({
          draft: retry.text,
          task: prompt,
          brandId,
          teamId: template.teamId,
          userId: run.userId,
          refId: run.id,
        });
        // Keep the regenerated draft even if it still fails: it has strictly
        // fewer named problems, and the receipt says what is left.
        text = retry.text;
        review = { ...second, rounds: MAX_REVIEW_ROUNDS };
      }
    }

    await db
      .update(taskRuns)
      .set({
        output: text,
        status: "done",
        // Null when the template did not opt in, so "not reviewed" stays
        // distinguishable from "reviewed and clean".
        review: review ? (review as unknown as Record<string, unknown>) : null,
      })
      .where(eq(taskRuns.id, run.id));
    return run.id;
  } catch (err) {
    console.error("runTaskOnce failed", err);
    await db
      .update(taskRuns)
      .set({
        status: "error",
        output: err instanceof Error ? err.message : "Task failed.",
      })
      .where(eq(taskRuns.id, run.id));
    return run.id;
  }
}
