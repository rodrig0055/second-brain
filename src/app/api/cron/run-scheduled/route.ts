import { requireCronSecret } from "@/lib/cron/auth";
import {
  runIntegrationSync,
  runLoopValidations,
  runScheduledTasks,
  runStorefrontSnapshots,
  runWikiMaintenance,
} from "@/lib/cron/blocks";

export const maxDuration = 300;

/**
 * Manual "run everything" entry point. NOT the scheduled path any more.
 *
 * The scheduled work is five separate cron entries in vercel.json, each hitting
 * its own route so each gets its own 300s budget. This route exists for backfill
 * and for reproducing a full tick by hand, and it deliberately ignores the
 * day-of-week gating the schedules apply: if you are calling this, you meant it.
 *
 * Because it runs all five blocks in one invocation it can exhaust the 300s
 * budget, which is exactly the failure that motivated the split. That is
 * acceptable for a hand-triggered call and not acceptable for a scheduled one,
 * which is the whole distinction. Prefer the individual routes when you only
 * need one block.
 */
export async function POST(req: Request) {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const { wiki, loops: planning } = await runWikiMaintenance();
  const validations = await runLoopValidations();
  const tasks = await runScheduledTasks();
  const sync = await runIntegrationSync();
  const storefront = await runStorefrontSnapshots();

  return Response.json({
    ran: tasks.ran,
    runIds: tasks.runIds,
    sync,
    storefront,
    wiki,
    loops: { ...planning, ...validations },
  });
}

// Vercel cron triggers GET by default; accept both.
export const GET = POST;
