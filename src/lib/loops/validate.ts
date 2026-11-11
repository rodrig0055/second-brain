import { Output, generateText, stepCountIs } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { hypotheses, openLoops, validations } from "@/db/schema";
import { resolveModel, PASS_MODELS } from "@/lib/models";
import { buildBrainTools } from "@/lib/tools/brain-tools";
import { logUsage } from "@/lib/usage";
import { captureSuccessorLoop } from "./capture";
import { todayBlock } from "./clock";

/**
 * Run a hypothesis and resolve it.
 *
 * This is the stage where the pipeline stops being an essay: the plan's pulls are
 * executed against live data through the same brand-scoped tools the chat uses,
 * and the verdict is judged against the bar that was written before any of it ran.
 *
 * Four verdicts, kept distinct because collapsing them is how a research habit
 * rots. **invalidated** is a real answer and a useful one. **inconclusive** means
 * the evidence genuinely points both ways. **insufficient** means the pulls could
 * not gather enough to judge, which is a statement about our data and not about
 * the prediction. Calling the last two "invalidated" would quietly convert every
 * gap in our reporting into a false negative.
 *
 * A validation is not forever. Every verdict carries a revalidate-by date,
 * because the account and the market move under a confirmed finding.
 */

// Reasoning over live tool output and holding itself to a pre-written bar is the
// hardest job in this pipeline, so it gets the strongest model of the four.
export const VALIDATE_MODEL = PASS_MODELS.loopValidate;

/** How long a verdict is trusted before it should be re-checked. */
export const REVALIDATE_DAYS: Record<string, number> = {
  validated: 90,
  invalidated: 180, // a dead end stays dead longer than a live finding stays true
  inconclusive: 30,
  insufficient: 30,
};

const verdictSchema = z.object({
  verdict: z.enum(["validated", "invalidated", "inconclusive", "insufficient"]),
  findings: z
    .string()
    .max(2000)
    .describe(
      "What the pulls actually returned and how it met or missed the bar. Lead with the numbers. Say which pull each figure came from.",
    ),
  pulls: z
    .array(
      z.object({
        tool: z.string(),
        result: z
          .string()
          .max(600)
          .describe("What this pull returned, with the actual figures."),
      }),
    )
    .describe("One entry per pull you actually made. Do not list a pull you did not run."),
  blindSpots: z
    .array(z.string())
    .describe(
      "Pulls that failed, returned nothing, or were not possible. This is what separates 'insufficient' from 'invalidated', so be complete.",
    ),
  nextQuestion: z
    .object({
      question: z
        .string()
        .max(300)
        .describe("The one open question this answer raises. Genuinely open."),
      observation: z.string().max(500),
      pull: z.enum([
        "curiosity",
        "resonance",
        "surprise",
        "tension",
        "pattern",
        "gap",
      ]),
      pullNote: z.string().max(300),
      justification: z.string().max(400),
      territory: z.enum([
        "demand",
        "offer",
        "message",
        "audience",
        "economics",
        "retention",
      ]),
    })
    .nullable()
    .describe(
      "The next question this finding raises, or null if it genuinely closes the matter. An answer usually opens something.",
    ),
});

const SYSTEM = `You are running a pre-planned test for a marketing team and returning a verdict. You did not write the prediction, and your job is not to support it.

**Run the plan with the tools.** Make the pulls the plan names. Report the real figures you get back. If a pull errors or returns nothing, say so in blindSpots rather than reasoning around the gap.

**Judge against the bar you were given, not against your own instinct.** The bar was written before the research on purpose. If the evidence meets the invalidated condition, the verdict is invalidated even if the prediction sounded sensible.

**The four verdicts are not interchangeable:**
- **validated** and **invalidated** are both real answers. An invalidated prediction is a useful result, not a failure, and you should reach it without hedging when the evidence says so.
- **inconclusive** is for when the test ran properly and the evidence genuinely points both ways.
- **insufficient** is for when the pulls could not gather enough to judge: a tool failed, the date range had no data, the cut was not available. This is a statement about our data, never about the prediction. Do not label a data gap as invalidated.

**Never invent a figure.** Every number in your findings comes from a pull you actually made. If you could not get a number, the verdict is insufficient and the gap goes in blindSpots. A fabricated figure here would poison a document the team treats as settled.

**Then open the next question.** A finding almost always raises one. Make it genuinely open, and null only when the matter is really closed.

Plain language, no em dashes.`;

export type ValidateResult = {
  hypothesisId: string;
  validationId: string | null;
  verdict: string | null;
  nextLoopId: string | null;
  error?: string;
};

export async function validateHypothesis(
  hypothesisId: string,
): Promise<ValidateResult> {
  const hypothesis = await db.query.hypotheses.findFirst({
    where: eq(hypotheses.id, hypothesisId),
    with: { brand: true, loop: { with: { team: true } } },
  });
  if (!hypothesis) {
    return {
      hypothesisId,
      validationId: null,
      verdict: null,
      nextLoopId: null,
      error: "hypothesis not found",
    };
  }
  if (hypothesis.state !== "ready") {
    return {
      hypothesisId,
      validationId: null,
      verdict: null,
      nextLoopId: null,
      error: `hypothesis is ${hypothesis.state}, only ready ones run`,
    };
  }

  try {
    const brand = {
      id: hypothesis.brand.id,
      slug: hypothesis.brand.slug,
      name: hypothesis.brand.name,
      domain: hypothesis.brand.domain,
    };
    // The same brand-scoped tools the chat uses. Unscoped by team on purpose: a
    // question about economics may need Meta spend and Shopify revenue together,
    // and the team scoping exists to keep a chat on-channel, not to keep research
    // from triangulating.
    const tools = await buildBrainTools(brand);

    const planBlock = hypothesis.testPlan
      .map(
        (s, i) =>
          `${i + 1}. tool: ${s.tool}\n   pull: ${s.pull}\n   right vs wrong: ${s.looksLike}`,
      )
      .join("\n");

    const { experimental_output: object, totalUsage } = await generateText({
      model: await resolveModel(VALIDATE_MODEL),
      // The date is not optional. Without it the model has no clock, invents a
      // window, and pulls a range with no data in it — which then reads as a
      // genuine "insufficient evidence" verdict rather than as our own bug. That
      // is exactly what happened on the first real run of this function: it
      // queried 2024-02-20 to 2024-05-20 in July 2026 and concluded the data was
      // missing. A wrong date here does not error, it lies.
      system: `${SYSTEM}\n\n${todayBlock()}`,
      prompt:
        `Brand: ${hypothesis.brand.name} (${hypothesis.brand.domain})\n\n` +
        `# The question being settled\n${hypothesis.loop.question}\n\n` +
        `# Our prediction (this is a bet, not a fact)\n${hypothesis.prediction}\n\n` +
        `# The plan to run\n${planBlock}\n\n` +
        `# The bar, written before any research ran\n` +
        `- validated: ${hypothesis.bar.validated}\n` +
        `- invalidated: ${hypothesis.bar.invalidated}\n` +
        `- inconclusive: ${hypothesis.bar.inconclusive}\n` +
        `- insufficient: ${hypothesis.bar.insufficient}\n\n` +
        `Run the pulls now, then return the verdict.`,
      tools,
      stopWhen: stepCountIs(12),
      experimental_output: Output.object({ schema: verdictSchema }),
    });

    await logUsage({
      kind: "task",
      model: VALIDATE_MODEL,
      usage: totalUsage,
      userId: null,
      brandId: hypothesis.brandId,
      teamId: hypothesis.loop.teamId,
      refId: null,
    });

    const days = REVALIDATE_DAYS[object.verdict] ?? 90;
    const revalidateBy = new Date(Date.now() + days * 86_400_000);

    // The successor question is captured first so the validation can point at it,
    // which keeps the chain walkable in both directions.
    let nextLoopId: string | null = null;
    if (object.nextQuestion) {
      nextLoopId = await captureSuccessorLoop({
        brandId: hypothesis.brandId,
        teamId: hypothesis.loop.teamId,
        parentLoopId: hypothesis.loopId,
        sourceUserId: hypothesis.loop.sourceUserId,
        observation: object.nextQuestion.observation,
        pull: object.nextQuestion.pull,
        pullNote: object.nextQuestion.pullNote,
        question: object.nextQuestion.question,
        justification: object.nextQuestion.justification,
        territory: object.nextQuestion.territory,
        evidence: {
          sources: [`validation of hypothesis ${hypothesis.id}`],
        },
      });
    }

    const [row] = await db
      .insert(validations)
      .values({
        hypothesisId: hypothesis.id,
        brandId: hypothesis.brandId,
        verdict: object.verdict,
        findings: object.findings.trim(),
        evidence: { pulls: object.pulls, blindSpots: object.blindSpots },
        revalidateBy,
        nextLoopId,
        model: VALIDATE_MODEL,
      })
      .returning({ id: validations.id });

    await db
      .update(hypotheses)
      .set({ state: "resolved" })
      .where(eq(hypotheses.id, hypothesis.id));
    await db
      .update(openLoops)
      .set({ state: "answered" })
      .where(eq(openLoops.id, hypothesis.loopId));

    return {
      hypothesisId,
      validationId: row.id,
      verdict: object.verdict,
      nextLoopId,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`validateHypothesis failed for ${hypothesisId}`, err);
    // The hypothesis stays `ready` so the next sweep retries it. A failed run is
    // not a verdict, and writing one would be the worst possible outcome here.
    return {
      hypothesisId,
      validationId: null,
      verdict: null,
      nextLoopId: null,
      error,
    };
  }
}
