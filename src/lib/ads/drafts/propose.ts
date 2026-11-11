/**
 * The ad brief: say what you want to achieve, get drafts back.
 *
 * This is a task template like any other, so the questions asked, the prompt
 * and the model are all editable in Admin → Templates rather than compiled in
 * here. What this module adds is the half a prompt cannot supply: the account's
 * own numbers, assembled from stored insights, and the guards that stop a
 * suggestion doing damage — an ad set id the model invented would put real
 * budget behind the wrong audience.
 *
 * Nothing here writes to Meta. It produces drafts a person edits and saves into
 * the pipeline, which is where the existing paused-upload path picks them up.
 */
import { generateObject } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { taskRuns, taskTemplates } from "@/db/schema";
import { todayBlock } from "@/lib/loops/clock";
import { providerOf, resolveModel } from "@/lib/models";
import { buildSystemPrompt, fillTemplate } from "@/lib/prompt";
import { logUsage } from "@/lib/usage";

import { briefText, type DraftContext } from "./context";
import { BRIEF_FIELDS, CTA_OPTIONS } from "./fields";
import { lintAdCopy, type CopyFinding } from "./lint";

const variant = z.object({
  concept: z
    .string()
    .describe("Short name for the idea, as it goes on the pipeline card, e.g. 'Payday gift under P999'."),
  funnel: z.enum(["TOF", "MOF", "BOF"]),
  targetAdSetId: z
    .string()
    .describe("One of the ad set ids listed in the account context, copied exactly."),
  headline: z.string().describe("Meta headline. 25-40 characters works best; over 60 is cut off."),
  primaryText: z
    .string()
    .describe("The caption. Put the offer, the price and the date in the first 125 characters."),
  callToAction: z.enum(CTA_OPTIONS),
  assetDirection: z
    .string()
    .describe("What the 1:1 and the 9:16 should show, for whoever makes them."),
  rationale: z
    .string()
    .describe(
      "Which ad or number in the account context this leans on, named. Say plainly if there is nothing to lean on.",
    ),
});

const proposalSchema = z.object({
  variants: z.array(variant).min(1).max(3),
  // Required, not optional: OpenAI's structured outputs reject a schema whose
  // properties are not all required, so an absent note has to be an empty one.
  note: z
    .string()
    .describe(
      "Anything the person should know before using these, e.g. thin data or no matching ad set. Empty string if there is nothing.",
    ),
});

export type DraftVariant = z.infer<typeof variant> & {
  /** Copy problems found by the same lint that gates the pipeline. */
  findings: CopyFinding[];
  /** Set when the model named an ad set that is not in the account. */
  adSetWarning?: string;
};

export type ProposeResult = {
  variants: DraftVariant[];
  note: string;
  /** The task run this was recorded as, so a suggestion can be traced back. */
  runId: string | null;
  model: string;
};

export type BriefInputs = Record<string, string>;

export async function proposeDrafts(opts: {
  templateId: string;
  brandId: string;
  userId: string;
  inputs: BriefInputs;
  context: DraftContext;
  /** Overrides the template's model, as the task runner's picker does. */
  model?: string;
}): Promise<ProposeResult> {
  const template = await db.query.taskTemplates.findFirst({
    where: eq(taskTemplates.id, opts.templateId),
  });
  if (!template || !template.isActive) {
    throw new Error("That brief template is not available.");
  }

  const cleanInputs: BriefInputs = {};
  for (const field of template.inputFields) {
    cleanInputs[field.name] = (opts.inputs[field.name] ?? "").slice(0, 4000);
  }

  const modelId = opts.model || template.model;
  const [system, model] = await Promise.all([
    buildSystemPrompt(opts.brandId, template.teamId),
    resolveModel(modelId),
  ]);

  const prompt = [
    fillTemplate(template.promptTemplate, cleanInputs),
    "",
    "---",
    "",
    briefText(opts.context),
    "",
    todayBlock(),
  ].join("\n");

  const [run] = await db
    .insert(taskRuns)
    .values({
      templateId: template.id,
      userId: opts.userId,
      brandId: opts.brandId,
      inputs: cleanInputs,
      model: modelId,
      status: "running",
    })
    .returning({ id: taskRuns.id });

  let object: z.infer<typeof proposalSchema>;
  try {
    const result = await generateObject({
      model,
      schema: proposalSchema,
      system,
      prompt,
      ...(providerOf(modelId) === "anthropic"
        ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
        : {}),
    });
    object = result.object;
    await logUsage({
      kind: "task",
      model: modelId,
      usage: result.usage,
      userId: opts.userId,
      brandId: opts.brandId,
      teamId: template.teamId,
      refId: run?.id,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(taskRuns)
        .set({ status: "error", output: message.slice(0, 4000) })
        .where(eq(taskRuns.id, run.id));
    }
    // Named, not swallowed: the person chose a model and is owed the reason it
    // did not answer rather than an empty result that reads like "no ideas".
    throw new Error(`${modelId} could not write the brief: ${message.slice(0, 200)}`);
  }

  const known = new Set(opts.context.adSets.map((s) => s.id));
  const variants: DraftVariant[] = object.variants.map((v) => {
    const adSetKnown = known.has(v.targetAdSetId);
    return {
      ...v,
      // An invented ad set id is the one error here that spends money, so it is
      // cleared rather than shown: the person picks from the real list instead.
      targetAdSetId: adSetKnown ? v.targetAdSetId : "",
      adSetWarning: adSetKnown
        ? undefined
        : `Suggested an ad set (${v.targetAdSetId || "none"}) that is not in this account. Pick one below.`,
      findings: lintAdCopy({
        headline: v.headline,
        primaryText: v.primaryText,
        purpose: cleanInputs[BRIEF_FIELDS.purpose] || undefined,
        eventDate: cleanInputs[BRIEF_FIELDS.eventDate] || undefined,
      }),
    };
  });

  if (run) {
    await db
      .update(taskRuns)
      .set({
        status: "done",
        output: JSON.stringify({ ...object, variants }, null, 2),
      })
      .where(eq(taskRuns.id, run.id));
  }

  return {
    variants,
    note: object.note ?? "",
    runId: run?.id ?? null,
    model: modelId,
  };
}
