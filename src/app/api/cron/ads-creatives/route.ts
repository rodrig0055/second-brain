import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { requireCronSecret } from "@/lib/cron/auth";
import { classifyPending, refreshCreativeStatus } from "@/lib/ads/creatives/refresh";
import type { DbConnection } from "@/lib/integrations/types";

/**
 * Keep the creative cache current, nightly.
 *
 * Two jobs. Refreshing the status is cheap and matters most: the pivot's status
 * column and the failed-to-run rule both read it, and both were inert while the
 * only thing that ever wrote it was a button on a different page. Classifying
 * is slow and costs money, so it is capped and time-boxed, and picks up where
 * the last run stopped.
 *
 * Runs after the 06:00 sync and well before the 23:00 rules pass, so the rules
 * judge a status that was true this morning.
 */
export const maxDuration = 300;

const CLASSIFY_PER_ACCOUNT = 20;
const BUDGET_MS = 240_000;

export async function POST(req: Request): Promise<Response> {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const startedAt = Date.now();
  const conns = await db
    .select()
    .from(integrationConnections)
    .where(
      and(
        eq(integrationConnections.platform, "meta"),
        eq(integrationConnections.status, "connected"),
      ),
    );

  const results: Record<string, unknown>[] = [];

  for (const [i, conn] of conns.entries()) {
    // Split what is left of the budget over the accounts still to come, so the
    // last account is not starved by the first one taking everything.
    const remaining = conns.length - i;
    const slice = Math.max(20_000, Math.floor((BUDGET_MS - (Date.now() - startedAt)) / remaining));
    const deadline = Date.now() + slice;

    try {
      const refreshed = await refreshCreativeStatus(conn as DbConnection, { sinceDays: 30 });
      const classified =
        Date.now() < deadline
          ? await classifyPending(conn as DbConnection, {
              max: CLASSIFY_PER_ACCOUNT,
              deadlineMs: deadline,
              concurrency: 3,
            })
          : { classified: 0, failed: 0, remaining: -1 };
      results.push({ connectionId: conn.id, brandId: conn.brandId, refreshed, classified });
    } catch (err) {
      // One account's token problem must not stop the others.
      results.push({
        connectionId: conn.id,
        brandId: conn.brandId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary = { ok: true, accounts: conns.length, ms: Date.now() - startedAt, results };
  // Vercel discards a cron's response body, so without this line a per-account
  // error is invisible. That is how this pass went a month writing nothing.
  console.log("[ads-creatives]", JSON.stringify(summary));
  return Response.json(summary);
}

export const GET = POST;
