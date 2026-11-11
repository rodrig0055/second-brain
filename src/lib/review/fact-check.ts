import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel, PASS_MODELS } from "@/lib/models";
import { logUsage } from "@/lib/usage";

/**
 * Fact-check pass for chat answers that followed a skill.
 *
 * The review gate in ./review.ts checks a draft against the brand docs. Skill
 * answers fail differently: the agent pulls live data (Search Console, Ahrefs,
 * fetched pages, storefront prices) and then writes claims the data does not
 * support, e.g. a price tier for a product it never looked up, "free delivery"
 * no page states, or "[verified]" on a page whose fetch failed. So this pass
 * checks the answer against the evidence gathered in the same turn: every tool
 * result, plus the brand docs in the system prompt.
 *
 * Same structural rule as the review gate: the checker is not the writer. It
 * sees the finished answer and the raw tool output, never the writer's
 * reasoning.
 */

export const FACT_CHECK_MODEL = PASS_MODELS.review;

const checkSchema = z.object({
  checks: z
    .array(
      z.object({
        claim: z.string().describe("The claim, quoted or closely paraphrased from the answer."),
        status: z
          .enum(["supported", "unsupported", "contradicted"])
          .describe(
            "'supported' = a tool result or brand doc states it. 'contradicted' = the evidence says otherwise. 'unsupported' = nothing in the evidence states it (the writer added it).",
          ),
        evidence: z
          .string()
          .describe(
            "One line: which tool result or doc supports or contradicts it, with the relevant value. For 'unsupported', say what was looked at.",
          ),
        fix: z
          .string()
          .optional()
          .describe("For contradicted or unsupported claims: the corrected text, or 'remove'."),
      }),
    )
    .describe(
      "Every price, offer or commitment (delivery, discounts, MOQ, payment terms, lead times), number, date, ranking, and every claim tagged [verified]. Skip opinions and recommendations.",
    ),
});

export type FactCheckResult = {
  status: "done" | "skipped" | "failed";
  /** Why the check was skipped or failed; shown to the user. */
  reason?: string;
  checks: z.infer<typeof checkSchema>["checks"];
};

/** The slice of a streamText step these helpers read; any tool set fits it. */
type ToolStep = {
  toolCalls: { toolName: string }[];
  toolResults: { toolName: string; input: unknown; output: unknown }[];
};

const MAX_RESULT_CHARS = 8000;
const MAX_EVIDENCE_CHARS = 160_000;

/** Every tool call and its result from the turn, as text the checker can read. */
export function collectEvidence(steps: ToolStep[]): string {
  const blocks: string[] = [];
  let total = 0;
  for (const step of steps) {
    for (const r of step.toolResults) {
      if (r.toolName === "load_skill" || r.toolName === "present") continue;
      const body = JSON.stringify(r.output);
      const clipped =
        body.length > MAX_RESULT_CHARS ? `${body.slice(0, MAX_RESULT_CHARS)}…[truncated]` : body;
      const block = `## ${r.toolName} ${JSON.stringify(r.input)}\n${clipped}`;
      if (total + block.length > MAX_EVIDENCE_CHARS) {
        blocks.push("…[further tool results omitted for length]");
        return blocks.join("\n\n");
      }
      blocks.push(block);
      total += block.length;
    }
  }
  return blocks.join("\n\n");
}

/** True when the turn followed a skill, i.e. the agent called load_skill. */
export function usedSkill(steps: ToolStep[]): boolean {
  return steps.some((s) => s.toolCalls.some((c) => c.toolName === "load_skill"));
}

export async function factCheckAnswer({
  answer,
  evidence,
  system,
  budgetMs,
  usage,
}: {
  answer: string;
  evidence: string;
  /** The brand system prompt, so brand docs count as evidence too. */
  system: string;
  budgetMs: number;
  usage: { userId: string; brandId: string; teamId: string; refId: string };
}): Promise<FactCheckResult> {
  if (budgetMs < 20_000) {
    return {
      status: "skipped",
      reason: "The answer used nearly all of the request's time, so there was none left to check it. Verify prices, offers and figures by hand.",
      checks: [],
    };
  }
  try {
    const { object, usage: u } = await generateObject({
      model: await resolveModel(FACT_CHECK_MODEL),
      schema: checkSchema,
      abortSignal: AbortSignal.timeout(budgetMs),
      system:
        `${system}\n\n---\n\nYou are now a fact-checker, not the writer. You will get an answer another ` +
        `agent wrote and the raw results of every tool it called. Check the answer's factual claims ` +
        `against those tool results and the brand docs above. Be strict: a claim is 'supported' only ` +
        `if the evidence actually states it. Prices must match the looked-up price. Offers (free ` +
        `delivery, discounts, MOQs, payment terms, guarantees) must appear in a fetched page or a ` +
        `brand doc. A claim tagged [verified] about a page whose fetch returned an error is ` +
        `'unsupported'. A tool or snapshot error is evidence the TOOL failed, not that the site is ` +
        `broken. Ignore recommendations and opinions.`,
      prompt: `# Answer to check\n\n${answer}\n\n# Tool results from this turn\n\n${evidence || "(no tool results)"}`,
    });
    await logUsage({ kind: "chat", model: FACT_CHECK_MODEL, usage: u, ...usage });
    return { status: "done", checks: object.checks };
  } catch (err) {
    console.error("factCheckAnswer failed", err);
    return {
      status: "failed",
      reason: "The fact check could not run. Verify prices, offers and figures by hand.",
      checks: [],
    };
  }
}
