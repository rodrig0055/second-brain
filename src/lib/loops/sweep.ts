import { and, asc, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, hypotheses, openLoops, validations } from "@/db/schema";
import { buildBrainTools } from "@/lib/tools/brain-tools";
import { advanceLoop } from "./advance";
import { runWeeklyRollup } from "./rollup";
import { validateHypothesis } from "./validate";

/**
 * The scheduled halves of the loops pipeline.
 *
 * Planning and running are split across different cadences on purpose, because
 * they cost wildly different amounts. Grading and planning are one cheap model
 * call each and most brands have nothing to grade, so they ride the weekly
 * maintenance tick. Running a validation makes up to a dozen live tool calls and
 * takes minutes, so it is strictly rationed per tick — the daily cron shares a
 * 300s budget, and an unbounded validation sweep is exactly the shape of thing
 * that silently ate the weekly wiki block before.
 */

/** Hard cap per tick. Bounded cost matters more here than throughput. */
export const MAX_VALIDATIONS_PER_TICK = 1;

/** The live tool names a brand can actually pull from. */
async function toolNamesFor(brand: {
  id: string;
  slug: string;
  name: string;
}): Promise<string[]> {
  const [row] = await db.select().from(brands).where(eq(brands.id, brand.id));
  if (!row) return [];
  return Object.keys(await buildBrainTools(row));
}

/** Weekly: grade every captured loop, then plan a test for whatever got promoted. */
export async function runWeeklyLoopPlanning(): Promise<{
  graded: number;
  promoted: number;
  advanced: number;
  unvalidatable: number;
  failed: number;
}> {
  const rollup = await runWeeklyRollup(toolNamesFor);

  let advanced = 0;
  let unvalidatable = 0;
  let failed = rollup.failed;

  const promoted = await db.query.openLoops.findMany({
    where: eq(openLoops.state, "promoted"),
    with: { brand: true },
  });
  for (const loop of promoted) {
    try {
      const r = await advanceLoop(
        loop.id,
        await toolNamesFor({
          id: loop.brand.id,
          slug: loop.brand.slug,
          name: loop.brand.name,
        }),
      );
      if (r.unvalidatable) unvalidatable++;
      else if (r.hypothesisId) advanced++;
    } catch (err) {
      failed++;
      console.error(`advanceLoop failed for ${loop.id}`, err);
    }
  }

  return {
    graded: rollup.results.reduce((n, r) => n + r.graded, 0),
    promoted: rollup.promoted,
    advanced,
    unvalidatable,
    failed,
  };
}

/**
 * Daily: run the oldest ready hypotheses, up to the cap.
 *
 * Oldest first so nothing starves. A failed run leaves the hypothesis `ready`,
 * so it is simply retried on the next tick rather than being recorded as a
 * verdict, which would be the worst possible outcome.
 */
export async function runDueValidations(
  limit = MAX_VALIDATIONS_PER_TICK,
): Promise<{ ran: number; verdicts: string[]; failed: number }> {
  const ready = await db.query.hypotheses.findMany({
    where: eq(hypotheses.state, "ready"),
    orderBy: [asc(hypotheses.createdAt)],
    limit,
  });

  const verdicts: string[] = [];
  let failed = 0;
  for (const h of ready) {
    try {
      const r = await validateHypothesis(h.id);
      if (r.verdict) verdicts.push(r.verdict);
      else failed++;
    } catch (err) {
      failed++;
      console.error(`validateHypothesis threw for ${h.id}`, err);
    }
  }
  return { ran: verdicts.length, verdicts, failed };
}

/**
 * Re-validation: a confirmed finding is not true forever.
 *
 * Every verdict carries a revalidate-by date. Past it, the answer is treated as
 * an open question again rather than quietly kept as settled fact, which is the
 * same discipline the knowledge docs get from their refresh cadence. The loop
 * returns to the queue and its existing plan is re-run, so the comparison is
 * like for like.
 */
export async function reopenStaleValidations(): Promise<number> {
  const stale = await db
    .select({
      hypothesisId: validations.hypothesisId,
      loopId: hypotheses.loopId,
    })
    .from(validations)
    .innerJoin(hypotheses, eq(validations.hypothesisId, hypotheses.id))
    .where(
      and(
        eq(hypotheses.state, "resolved"),
        lte(validations.revalidateBy, sql`now()`),
      ),
    );

  for (const row of stale) {
    await db
      .update(hypotheses)
      .set({ state: "ready" })
      .where(eq(hypotheses.id, row.hypothesisId));
    await db
      .update(openLoops)
      .set({ state: "promoted" })
      .where(eq(openLoops.id, row.loopId));
  }
  return stale.length;
}
