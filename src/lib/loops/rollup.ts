import { generateObject } from "ai";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { brands, openLoops } from "@/db/schema";
import { resolveModel, PASS_MODELS } from "@/lib/models";
import { logUsage } from "@/lib/usage";

/**
 * The roll-up: grade every captured loop for a brand, together.
 *
 * Capture and grading are deliberately separate stages. Capture writes down
 * everything with a real pull behind it and never scores itself, so nothing gets
 * killed at the moment of noticing. Grading then reads the whole pile at once,
 * which is the only point where the useful comparisons are possible: this
 * question subsumes that one, these three are the same question in different
 * words, this one looked interesting alone and looks trivial beside the others.
 *
 * Scoring one loop at a time would lose all of that, which is why this takes the
 * set rather than the item.
 */

export const ROLLUP_MODEL = PASS_MODELS.loops;

/** Tier 1 is chased now, tier 2 is kept warm, tier 3 is archived with reasoning. */
export const TIER_1_MIN = 14;
export const TIER_2_MIN = 10;

const dim = (what: string) =>
  z.number().int().min(1).max(5).describe(what);

const rollupSchema = z.object({
  graded: z
    .array(
      z.object({
        id: z.string().describe("The loop id, exactly as given."),
        stakes: dim(
          "1-5. How much would actually change if this were answered? 5 = it would redirect budget or strategy. 1 = it would be interesting and change nothing.",
        ),
        confidence: dim(
          "1-5. How solid is the evidence that the observation is real? 5 = verified in data or stated plainly by the team. 1 = one offhand remark.",
        ),
        researchability: dim(
          "1-5. Can it be answered with the tools listed below? 5 = a couple of pulls settle it. 1 = it needs data we cannot reach, or a real-world experiment.",
        ),
        novelty: dim(
          "1-5. Is this genuinely not already known? 5 = nobody has looked. 1 = the answer is already in the brand docs or another loop.",
        ),
        reasoning: z
          .string()
          .max(300)
          .describe("One or two sentences justifying the scores. Name the deciding factor."),
        duplicateOf: z
          .string()
          .nullable()
          .describe(
            "If another loop in this set asks the same question in different words, that loop's id. The duplicate gets archived; keep the better-phrased one.",
          ),
      }),
    )
    .describe("Every loop given to you, scored. Do not skip any."),
});

const SYSTEM = `You are grading a marketing team's open questions to decide which are worth spending research effort on this week. You see the whole set at once, which is the point: judge each one against the others, not in isolation.

Score four dimensions from 1 to 5. Be a hard marker. If everything scores 4s and 5s the ranking carries no information and the team will chase the wrong thing.

- **stakes** is the dimension that matters most. Ask what the team would DO differently. A question whose answer changes budget allocation or strategy is a 5. A question whose answer is merely satisfying is a 1, no matter how interesting it sounds.
- **confidence** is about the observation, not the answer. Solid evidence, or the team saying it plainly, is high. One passing remark is low.
- **researchability** is honest about our reach. If answering needs a real-world test, a competitor's private data, or a source we cannot read, score it 1 and say so, rather than pretending a plan exists.
- **novelty** is low when the answer already sits in the brand docs, or when another loop in this set already covers it.

**Find the duplicates.** Loops arrive from different weeks and different chats, so the same question shows up in different words. Point the weaker phrasing at the stronger one with duplicateOf. This is most of the value of grading a set rather than an item.

Plain language, no em dashes.`;

export type RollupResult = {
  brand: string;
  graded: number;
  promoted: number;
  archived: number;
  ok: boolean;
  error?: string;
};

/**
 * Grade and route every captured loop for one brand.
 *
 * Promotion and archiving both happen here, and archiving keeps its reasoning: a
 * known dead end at a known bar is worth more than a lost noticing, and it stops
 * the same question being re-captured next month.
 */
export async function rollupBrandLoops(
  brand: { id: string; slug: string; name: string },
  toolNames: string[],
): Promise<RollupResult> {
  try {
    const captured = await db.query.openLoops.findMany({
      where: and(eq(openLoops.brandId, brand.id), eq(openLoops.state, "captured")),
    });
    if (captured.length === 0) {
      return { brand: brand.slug, graded: 0, promoted: 0, archived: 0, ok: true };
    }

    // Loops already in flight or already ruled out, so the grader can see what
    // is a duplicate of settled work rather than re-promoting it.
    const decided = await db.query.openLoops.findMany({
      where: and(
        eq(openLoops.brandId, brand.id),
        inArray(openLoops.state, ["promoted", "archived", "answered"]),
      ),
      columns: { question: true, state: true, archivedReason: true },
    });

    const setBlock = captured
      .map(
        (l) =>
          `## ${l.id}\n` +
          `territory: ${l.territory} | pull: ${l.pull}\n` +
          `observation: ${l.observation}\n` +
          `QUESTION: ${l.question}\n` +
          `why it matters: ${l.justification}`,
      )
      .join("\n\n");

    const decidedBlock =
      decided.length > 0
        ? `\n\n# Questions already settled or in flight (score novelty low if one of these already covers a loop)\n${decided
            .map(
              (d) =>
                `- [${d.state}] ${d.question}${d.archivedReason ? ` (archived: ${d.archivedReason})` : ""}`,
            )
            .join("\n")}`
        : "";

    const { object, usage } = await generateObject({
      model: await resolveModel(ROLLUP_MODEL),
      schema: rollupSchema,
      system: SYSTEM,
      prompt:
        `Brand: ${brand.name}\n\n` +
        `# Data we can actually pull to answer questions\n${toolNames.length ? toolNames.join(", ") : "(no live tools connected for this brand)"}\n\n` +
        `# The loops to grade (${captured.length})\n${setBlock}${decidedBlock}\n\n` +
        `Grade all ${captured.length}.`,
    });

    await logUsage({
      kind: "task",
      model: ROLLUP_MODEL,
      usage,
      userId: null,
      brandId: brand.id,
      teamId: null,
      refId: null,
    });

    const byId = new Map(captured.map((l) => [l.id, l]));
    let promoted = 0;
    let archived = 0;

    for (const g of object.graded) {
      const loop = byId.get(g.id);
      if (!loop) continue; // hallucinated id; ignore rather than mis-write

      const total = g.stakes + g.confidence + g.researchability + g.novelty;
      const score = {
        stakes: g.stakes,
        confidence: g.confidence,
        researchability: g.researchability,
        novelty: g.novelty,
        total,
        reasoning: g.reasoning,
      };

      // A duplicate is archived regardless of score, but only when it points at a
      // real loop in this set and not at itself.
      const isDuplicate =
        g.duplicateOf && g.duplicateOf !== g.id && byId.has(g.duplicateOf);

      if (isDuplicate) {
        await db
          .update(openLoops)
          .set({
            score,
            tier: 3,
            state: "archived",
            archivedReason: `Duplicate of loop ${g.duplicateOf}. ${g.reasoning}`,
            gradedAt: new Date(),
          })
          .where(eq(openLoops.id, loop.id));
        archived++;
        continue;
      }

      const tier = total >= TIER_1_MIN ? 1 : total >= TIER_2_MIN ? 2 : 3;
      // Researchability is a veto, not just a weight. A question we cannot reach
      // the data for is not promotable however high the stakes, and pretending
      // otherwise produces a hypothesis with a fictional test plan.
      const promotable = tier === 1 && g.researchability >= 2;

      await db
        .update(openLoops)
        .set({
          score,
          tier,
          state: promotable ? "promoted" : tier === 3 ? "archived" : "captured",
          archivedReason:
            tier === 3
              ? g.reasoning
              : tier === 1 && !promotable
                ? `Tier 1 on stakes but we cannot reach the data: ${g.reasoning}`
                : "",
          gradedAt: new Date(),
        })
        .where(eq(openLoops.id, loop.id));

      if (promotable) promoted++;
      else if (tier === 3) archived++;
    }

    return {
      brand: brand.slug,
      graded: object.graded.length,
      promoted,
      archived,
      ok: true,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`loop roll-up failed for ${brand.slug}`, err);
    return {
      brand: brand.slug,
      graded: 0,
      promoted: 0,
      archived: 0,
      ok: false,
      error,
    };
  }
}

/** The weekly roll-up across every brand, each isolated. */
export async function runWeeklyRollup(
  toolNamesFor: (brand: { id: string; slug: string; name: string }) => Promise<string[]>,
): Promise<{ ok: number; failed: number; promoted: number; results: RollupResult[] }> {
  const all = await db
    .select({ id: brands.id, slug: brands.slug, name: brands.name })
    .from(brands);
  const results: RollupResult[] = [];
  for (const brand of all) {
    try {
      results.push(await rollupBrandLoops(brand, await toolNamesFor(brand)));
    } catch (err) {
      console.error(`roll-up threw outside rollupBrandLoops for ${brand.slug}`, err);
      results.push({
        brand: brand.slug,
        graded: 0,
        promoted: 0,
        archived: 0,
        ok: false,
        error: String(err),
      });
    }
  }
  return {
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    promoted: results.reduce((n, r) => n + r.promoted, 0),
    results,
  };
}
