import { generateObject } from "ai";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { loopPull, loopTerritory, openLoops, proposals } from "@/db/schema";
import { resolveModel, PASS_MODELS } from "@/lib/models";
import { logUsage } from "@/lib/usage";

/**
 * Turn an accepted `open-loop` proposal into a real open loop.
 *
 * This is the one place a proposal becomes machinery rather than a note, and it
 * is worth automating because the shape is fixed: a loop needs an observation, a
 * named pull, exactly one open question, a justification, and a territory. The
 * proposal already carries the evidence and the question in prose; this is a
 * reshaping, not a new judgment.
 *
 * What it does NOT do is grade. Capture captures; the weekly roll-up decides what
 * is worth chasing. Scoring at the moment of noticing kills loops before anyone
 * has seen them next to each other.
 */

export const CAPTURE_MODEL = PASS_MODELS.loops;

const loopSchema = z.object({
  observation: z
    .string()
    .max(500)
    .describe("What was noticed, in one or two plain sentences."),
  pull: z
    .enum(["curiosity", "resonance", "surprise", "tension", "pattern", "gap"])
    .describe(
      "Why this became a question. curiosity = we cannot explain it; resonance = it is notably good and we want to know why; surprise = it contradicts what we expected; tension = two sources disagree; pattern = it keeps recurring; gap = an absence where presence was expected.",
    ),
  pullNote: z
    .string()
    .max(300)
    .describe("One sentence: what specifically turned the observation into a question."),
  question: z
    .string()
    .max(300)
    .describe(
      "The ONE open question. Start with What, How much, Why, Who, or Where. Do not build the answer into it, do not stack two questions, and do not phrase a recommendation as a question. Plain enough that a smart 13-year-old would understand it.",
    ),
  justification: z
    .string()
    .max(400)
    .describe(
      "One or two sentences on what would change for this brand if the question were answered. If nothing would change, it is not a loop.",
    ),
  territory: z
    .enum(["demand", "offer", "message", "audience", "economics", "retention"])
    .describe(
      "demand = where traffic and demand come from; offer = pricing, promos, product mix; message = what we say and show; audience = who we reach and who we miss; economics = CAC, ROAS, MER, budget allocation; retention = repeat purchase, lifecycle, email. Pick the closest one.",
    ),
});

const SYSTEM = `You reshape an accepted proposal into a properly formed open loop for a marketing team's research pipeline.

An open loop is a QUESTION the team cannot currently answer, whose answer would change what they do. It is not a task, not a recommendation with a question mark on the end, and not a maintenance chore.

Three rules decide whether the output is any good:
- **The question must be genuinely open.** If the phrasing already contains the answer ("should we refresh the fatigued creative?"), rewrite it so research could come back either way ("how much of the CTR decline on this ad set is fatigue rather than audience saturation?").
- **One question. Never two.** If the proposal carries two, take the one that would change more, and ignore the other.
- **Infrastructure is not a loop.** A broken sync or a missing connection is a chore. If that is all the proposal is, the question you produce should be about the business, not the plumbing.

Keep the team's own words where they are load-bearing. Plain language, no em dashes.`;

export type CaptureResult = {
  loopId: string | null;
  reason?: string;
};

/**
 * Capture a loop from an accepted proposal. Idempotent: a proposal that already
 * produced a loop returns the existing one rather than a duplicate.
 */
export async function captureLoopFromProposal(
  proposalId: string,
): Promise<CaptureResult> {
  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, proposalId),
  });
  if (!proposal) return { loopId: null, reason: "proposal not found" };
  if (proposal.kind !== "open-loop") {
    return { loopId: null, reason: `proposal is a ${proposal.kind}, not an open-loop` };
  }

  const existing = await db.query.openLoops.findFirst({
    where: eq(openLoops.sourceProposalId, proposalId),
  });
  if (existing) return { loopId: existing.id, reason: "already captured" };

  const evidence = proposal.evidence ?? {};
  const quoteBlock = (evidence.quotes ?? [])
    .map((q) => `- "${q.text}" (${q.source})`)
    .join("\n");

  const { object, usage } = await generateObject({
    model: await resolveModel(CAPTURE_MODEL),
    schema: loopSchema,
    system: SYSTEM,
    prompt:
      `# The accepted proposal\nTitle: ${proposal.title}\n\n${proposal.body}\n\n` +
      `# The evidence under it\n${quoteBlock || "(none recorded)"}\n\n` +
      `Reshape this into one open loop.`,
  });

  await logUsage({
    kind: "task",
    model: CAPTURE_MODEL,
    usage,
    userId: proposal.decidedById,
    brandId: proposal.brandId,
    teamId: proposal.teamId,
    refId: null,
  });

  const [row] = await db
    .insert(openLoops)
    .values({
      brandId: proposal.brandId,
      teamId: proposal.teamId,
      observation: object.observation.trim(),
      pull: object.pull,
      pullNote: object.pullNote.trim(),
      question: object.question.trim(),
      justification: object.justification.trim(),
      territory: object.territory,
      evidence,
      // Ungraded on purpose. The roll-up scores it.
      state: "captured",
      sourceProposalId: proposal.id,
      // Whose work raised the question, carried through from the proposal. This
      // is what puts the loop on that person's dashboard rather than only in an
      // admin page. Distinct from createdById, which is whoever accepted it.
      sourceUserId: proposal.sourceUserId,
      createdById: proposal.decidedById,
    })
    .returning({ id: openLoops.id });

  return { loopId: row.id };
}

/**
 * Capture the successor question a validation raised.
 *
 * A finding almost always opens the next question, and this is what keeps the
 * pipeline circular rather than terminating at a verdict. The successor is linked
 * to its parent so the chain of reasoning stays walkable.
 */
export async function captureSuccessorLoop(args: {
  brandId: string;
  teamId: string | null;
  parentLoopId: string;
  /** Inherited from the parent so a chain stays with whoever started it. */
  sourceUserId?: string | null;
  observation: string;
  pull: (typeof loopPull.enumValues)[number];
  pullNote: string;
  question: string;
  justification: string;
  territory: (typeof loopTerritory.enumValues)[number];
  evidence?: Record<string, unknown>;
}): Promise<string> {
  const [row] = await db
    .insert(openLoops)
    .values({
      brandId: args.brandId,
      teamId: args.teamId,
      observation: args.observation,
      pull: args.pull,
      pullNote: args.pullNote,
      question: args.question,
      justification: args.justification,
      territory: args.territory,
      evidence: (args.evidence ?? {}) as never,
      state: "captured",
      parentLoopId: args.parentLoopId,
      sourceUserId: args.sourceUserId ?? null,
    })
    .returning({ id: openLoops.id });
  return row.id;
}
