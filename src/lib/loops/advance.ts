import { generateObject } from "ai";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { hypotheses, openLoops } from "@/db/schema";
import { resolveModel, PASS_MODELS } from "@/lib/models";
import { logUsage } from "@/lib/usage";
import { todayBlock } from "./clock";

/**
 * Advance a promoted loop into a hypothesis.
 *
 * The loop's open question becomes a prediction that evidence could refute, plus
 * the few pulls that would settle it, plus what each outcome would mean. The bar
 * is written now, before any research runs, because a bar set afterwards is not a
 * bar, it is a rationalisation of whatever came back.
 *
 * This stage plans and never researches. A hypothesis document that already
 * contains findings skipped a stage, and the separation is what stops the whole
 * pipeline collapsing into "the model asserts something and then agrees".
 */

export const ADVANCE_MODEL = PASS_MODELS.loops;

const hypothesisSchema = z.object({
  unvalidatable: z
    .boolean()
    .describe(
      "true if this question genuinely cannot be settled with the listed tools. Say so rather than inventing a plan around data we cannot reach.",
    ),
  unvalidatableReason: z
    .string()
    .describe("If unvalidatable, what would be needed. Else an empty string."),
  prediction: z
    .string()
    .max(500)
    .describe(
      "The bet in one or two sentences, stated so evidence could prove it WRONG. Not a summary of the question and not a recommendation. If no result could refute it, it is not a hypothesis.",
    ),
  testPlan: z
    .array(
      z.object({
        tool: z
          .string()
          .describe(
            "The exact tool name from the available list. Never a tool that is not on it.",
          ),
        pull: z
          .string()
          .max(300)
          .describe("The specific pull: what to ask for, over what window, cut how."),
        looksLike: z
          .string()
          .max(300)
          .describe(
            "What this pull would show if the prediction is right, and what it would show if it is wrong. Both, so the pull can disconfirm.",
          ),
      }),
    )
    .min(1)
    .max(4)
    .describe(
      "A few complementary pulls that each see a DIFFERENT angle. Not one pull split into steps, and not a research programme. Read each source only as deep as its angle needs.",
    ),
  bar: z.object({
    validated: z.string().max(300).describe("What evidence would confirm the prediction."),
    invalidated: z.string().max(300).describe("What evidence would refute it."),
    inconclusive: z
      .string()
      .max(300)
      .describe("What a genuine both-ways result would look like."),
    insufficient: z
      .string()
      .max(300)
      .describe("What would mean the pulls could not gather enough to judge."),
  }),
});

const SYSTEM = `You turn a marketing team's open question into a testable hypothesis. You plan the test. You never run it, and you never state a finding.

**The prediction must be falsifiable.** Write the bet so a specific result would prove it wrong. "Zombie campaigns are worth reviewing" is not a hypothesis. "Zombie campaigns deliver a lower cost per purchase than standard campaigns at the same spend level, because they inherit learned audiences" is one, because a pull could come back the other way. Mark it as our prediction, never as a fact.

**Only name tools from the list you are given.** A plan that references a tool we do not have is a fiction that wastes the whole run. If the question cannot be reached with what is listed, set unvalidatable and say what would be needed. That is a useful answer, not a failure.

**Triangulate, do not over-engineer.** Pick a few pulls that each see a different angle, because one source has blind spots. Do not split a single pull into six steps of sub-analysis, and do not design a research programme. A strategist's afternoon, not a study.

**Build the disconfirming read into each pull.** For every pull, say what it would show if the prediction is right AND what it would show if it is wrong. A test that can only confirm is not a test.

**Write the bar before the research.** State plainly what result would validate, invalidate, leave it inconclusive, or mean the evidence was insufficient. Deciding afterwards is how a team convinces itself of whatever it already believed.

Plain language, no em dashes.`;

export type AdvanceResult = {
  loopId: string;
  hypothesisId: string | null;
  unvalidatable: boolean;
  reason?: string;
};

export async function advanceLoop(
  loopId: string,
  toolNames: string[],
): Promise<AdvanceResult> {
  const loop = await db.query.openLoops.findFirst({
    where: eq(openLoops.id, loopId),
    with: { brand: true },
  });
  if (!loop) return { loopId, hypothesisId: null, unvalidatable: false, reason: "loop not found" };
  if (loop.state !== "promoted") {
    return {
      loopId,
      hypothesisId: null,
      unvalidatable: false,
      reason: `loop is ${loop.state}, only promoted loops advance`,
    };
  }

  // Idempotent: a loop already carrying a live hypothesis is not re-planned.
  const existing = await db.query.hypotheses.findFirst({
    where: and(eq(hypotheses.loopId, loopId)),
  });
  if (existing) {
    return {
      loopId,
      hypothesisId: existing.id,
      unvalidatable: existing.state === "unvalidatable",
      reason: "already advanced",
    };
  }

  const { object, usage } = await generateObject({
    model: await resolveModel(ADVANCE_MODEL),
    schema: hypothesisSchema,
    // A plan says "the last 90 days"; the validator then has to resolve that to
    // real dates. Both stages need the same clock or the plan and the pull
    // disagree about what window was even tested.
    system: `${SYSTEM}\n\n${todayBlock()}`,
    prompt:
      `Brand: ${loop.brand.name} (${loop.brand.domain})\n\n` +
      `# Tools available to answer this — use ONLY these\n${
        toolNames.length ? toolNames.join(", ") : "(none: no live data is reachable for this brand)"
      }\n\n` +
      `# The open loop\n` +
      `territory: ${loop.territory} | pull: ${loop.pull}\n` +
      `observation: ${loop.observation}\n` +
      `QUESTION: ${loop.question}\n` +
      `why it matters: ${loop.justification}\n\n` +
      `Plan the test.`,
  });

  await logUsage({
    kind: "task",
    model: ADVANCE_MODEL,
    usage,
    userId: null,
    brandId: loop.brandId,
    teamId: loop.teamId,
    refId: null,
  });

  // Enforce the tool contract in code, not just in the prompt. A plan naming a
  // tool we do not have cannot be run, so it is better to fail loudly here than
  // to hand the validator an impossible step.
  const allowed = new Set(toolNames);
  const validSteps = object.testPlan.filter((s) => allowed.has(s.tool));
  const droppedTools = object.testPlan
    .filter((s) => !allowed.has(s.tool))
    .map((s) => s.tool);

  const unvalidatable = object.unvalidatable || validSteps.length === 0;
  const reason = object.unvalidatable
    ? object.unvalidatableReason
    : validSteps.length === 0
      ? `Every step named a tool we do not have (${droppedTools.join(", ")}).`
      : "";

  const [row] = await db
    .insert(hypotheses)
    .values({
      loopId: loop.id,
      brandId: loop.brandId,
      prediction: object.prediction.trim(),
      testPlan: validSteps,
      bar: object.bar,
      state: unvalidatable ? "unvalidatable" : "ready",
      unvalidatableReason: reason,
    })
    .returning({ id: hypotheses.id });

  // An unvalidatable loop is archived with its reason rather than left promoted
  // forever, so the queue reflects what can actually be worked on.
  if (unvalidatable) {
    await db
      .update(openLoops)
      .set({
        state: "archived",
        archivedReason: `Cannot be settled with the data we can reach. ${reason}`,
      })
      .where(eq(openLoops.id, loop.id));
  }

  return {
    loopId,
    hypothesisId: row.id,
    unvalidatable,
    reason: droppedTools.length
      ? `dropped steps naming unavailable tools: ${droppedTools.join(", ")}`
      : undefined,
  };
}
