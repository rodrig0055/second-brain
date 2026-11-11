import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brands, scheduledTasks } from "@/db/schema";
import { runTaskOnce } from "@/lib/run-task";
import { syncAllConnections } from "@/lib/integrations/sync";
import { snapshotAllStorefronts } from "@/lib/storefront/snapshot";
import { runWeeklyIngest } from "@/lib/wiki/ingest";
import { runWeeklyLint } from "@/lib/wiki/lint";
import { runWeeklyProposals } from "@/lib/proposals/propose";
import {
  reopenStaleValidations,
  runDueValidations,
  runWeeklyLoopPlanning,
} from "@/lib/loops/sweep";
import { logWikiActivity } from "@/lib/wiki/shared";

/**
 * The scheduled work, one exported function per block.
 *
 * These used to be five sequential sections of a single daily route sharing one
 * 300s budget, and that arrangement had already failed in production: on
 * 2026-07-28 the weekly wiki block silently stopped completing because the
 * budget went to the sync and the scheduled-task loop ahead of it. Whatever runs
 * last in a function that can time out is the thing that quietly stops running.
 *
 * The fix was not more time or a cleverer order, it was separate invocations.
 * Each block now gets its own cron entry, its own 300s, and its own log stream,
 * so one slow block cannot starve another and a timeout names its own culprit.
 * Day-of-week selection moved into the cron expressions in vercel.json, which is
 * why nothing here inspects `getUTCDay()` any more.
 *
 * Every block isolates its own failures, because a block that throws must not
 * turn into a failed cron invocation that hides what did succeed.
 */

export type WikiMaintenanceResult = {
  wiki: {
    ingested: number;
    linted: number;
    proposed: number;
    failed: number;
    error?: string;
  };
  loops: {
    graded: number;
    promoted: number;
    advanced: number;
    failed: number;
    error?: string;
  };
};

export type LoopValidationResult = {
  reopened: number;
  validated: number;
  verdicts: string[];
  failed: number;
  error?: string;
};

/**
 * Weekly wiki maintenance plus loop grading. Scheduled for Tuesdays, which is
 * deliberately after Monday's storefront snapshot so ingest reads a fresh
 * catalog rather than last week's.
 */
export async function runWikiMaintenance(): Promise<WikiMaintenanceResult> {
  const wiki: WikiMaintenanceResult["wiki"] = {
    ingested: 0,
    linted: 0,
    proposed: 0,
    failed: 0,
  };
  const loops: WikiMaintenanceResult["loops"] = {
    graded: 0,
    promoted: 0,
    advanced: 0,
    failed: 0,
  };

  try {
    const r = await runWeeklyIngest();
    wiki.ingested = r.ok;
    wiki.failed += r.failed;
  } catch (err) {
    wiki.error = String(err).slice(0, 300);
    await recordWikiTickFailure("ingest", err);
  }

  try {
    const r = await runWeeklyLint();
    wiki.linted = r.ok;
    wiki.failed += r.failed;
  } catch (err) {
    wiki.error = String(err).slice(0, 300);
    await recordWikiTickFailure("lint", err);
  }

  // The proactive pass, last of the three because its absence costs least: a
  // missed week of proposals is a missed nudge, while a missed ingest leaves the
  // whole brain quoting stale figures. It short-circuits per brand when the week
  // gave it nothing, so most brands cost no model call.
  try {
    const r = await runWeeklyProposals();
    wiki.proposed = r.filed;
    wiki.failed += r.failed;
  } catch (err) {
    wiki.error = String(err).slice(0, 300);
    await recordWikiTickFailure("propose", err);
  }

  // Grade the captured loops and plan a test for whatever got promoted. Both are
  // one cheap call per brand and most brands have nothing to grade, so this
  // belongs beside the rest of the weekly maintenance.
  try {
    const r = await runWeeklyLoopPlanning();
    loops.graded = r.graded;
    loops.promoted = r.promoted;
    loops.advanced = r.advanced;
    loops.failed += r.failed;
  } catch (err) {
    console.error("loop planning failed", err);
    loops.error = String(err).slice(0, 300);
  }

  return { wiki, loops };
}

/**
 * Re-open stale verdicts, then run whatever validations are due.
 *
 * Daily rather than weekly. The per-tick cap lives in `runDueValidations` as a
 * function default, not here: a validation makes up to a dozen live tool calls
 * and takes minutes, so it stays bounded on its own terms.
 */
export async function runLoopValidations(): Promise<LoopValidationResult> {
  const result: LoopValidationResult = {
    reopened: 0,
    validated: 0,
    verdicts: [],
    failed: 0,
  };

  try {
    result.reopened = await reopenStaleValidations();
    const r = await runDueValidations();
    result.validated = r.ran;
    result.verdicts = r.verdicts;
    result.failed += r.failed;
  } catch (err) {
    console.error("loop validation failed", err);
    result.error = String(err).slice(0, 300);
  }

  return result;
}

/**
 * Run the task templates users have scheduled.
 *
 * Cadence still lives per row rather than in the cron expression, because each
 * row carries its own `frequency`: weekly rows only fire on Mondays, daily rows
 * every day. The 20-hour guard protects against a manual trigger overlapping the
 * scheduled one.
 */
export async function runScheduledTasks(
  now = new Date(),
): Promise<{ ran: number; runIds: string[] }> {
  const due = await db.query.scheduledTasks.findMany({
    where: eq(scheduledTasks.isActive, true),
  });

  const runIds: string[] = [];
  for (const sched of due) {
    if (sched.frequency === "weekly" && now.getUTCDay() !== 1) continue;
    if (
      sched.lastRunAt &&
      now.getTime() - sched.lastRunAt.getTime() < 20 * 60 * 60 * 1000
    ) {
      continue;
    }

    const runId = await runTaskOnce({
      templateId: sched.templateId,
      brandId: sched.brandId,
      inputs: sched.inputs,
      userId: sched.createdById,
    });
    await db
      .update(scheduledTasks)
      .set({ lastRunAt: now })
      .where(eq(scheduledTasks.id, sched.id));
    if (runId) runIds.push(runId);
  }

  return { ran: runIds.length, runIds };
}

/** Refresh external data integrations (Shopify, SendPulse, ad platforms). */
export async function runIntegrationSync(): Promise<{
  synced: number;
  failed: number;
  error?: string;
}> {
  try {
    // Per-connection isolation already lives inside syncAllConnections.
    return await syncAllConnections();
  } catch (err) {
    console.error("integration sync failed", err);
    return { synced: 0, failed: 0, error: String(err).slice(0, 300) };
  }
}

/**
 * Snapshot storefront sitemaps and product feeds into history. Weekly, and
 * scheduled on Monday so Tuesday's wiki ingest reads a fresh catalog.
 */
export async function runStorefrontSnapshots(): Promise<{
  ok: number;
  failed: number;
  error?: string;
}> {
  try {
    const r = await snapshotAllStorefronts();
    return { ok: r.ok, failed: r.failed };
  } catch (err) {
    console.error("storefront snapshot failed", err);
    return { ok: 0, failed: 0, error: String(err).slice(0, 300) };
  }
}

/**
 * Record a wiki maintenance failure that happened ABOVE the per-brand loops.
 *
 * ingestBrand and lintBrand already catch and log their own failures, so a throw
 * that escapes to here took out the whole run for every brand. wiki_activity has
 * no system-level scope (brandId is NOT NULL), and that is fine here: the run
 * genuinely failed for all of them, so a row per brand is the accurate record,
 * not a workaround. Without it the only trace is a console line nobody reads,
 * which is exactly how this went unnoticed for over a week.
 */
async function recordWikiTickFailure(
  op: "ingest" | "lint" | "propose",
  err: unknown,
) {
  console.error(`wiki ${op} failed`, err);
  try {
    const all = await db.select({ id: brands.id }).from(brands);
    await Promise.all(
      all.map((b) =>
        logWikiActivity({
          brandId: b.id,
          op,
          action: "error",
          detail: `weekly ${op} aborted before the per-brand pass: ${String(err).slice(0, 400)}`,
          status: "error",
        }),
      ),
    );
  } catch (logErr) {
    console.error("could not record wiki tick failure", logErr);
  }
}
