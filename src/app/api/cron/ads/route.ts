import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { brands, integrationConnections } from "@/db/schema";
import { requireCronSecret } from "@/lib/cron/auth";
import { sweepActions } from "@/lib/ads/actions/executor";
import { ensureDigest } from "@/lib/ads/digest";
import { runRules } from "@/lib/ads/rules/run";
import { proposeFromAlerts } from "@/lib/ads/change-sets/propose";
import type { DbConnection } from "@/lib/integrations/types";

/**
 * The daily paid-media pass: judge, finish, summarise.
 *
 * Its own route, not an addition to the sync cron, for a reason this codebase
 * has already paid for once: whatever runs last in a shared route is the thing
 * that quietly stops running when the route overruns and gets retried, because
 * each retry starts again at the top. The sync is the long, failure-prone part,
 * so nothing that needs to happen every day belongs behind it.
 *
 * Ordered so the most important work happens first. If this route is ever the
 * one that overruns, alerts survive and the digest is the thing lost — and the
 * digest is rebuilt on the next page open anyway. Proposals sit second, because
 * an alert nobody can act on is the problem this pass exists to fix, and they
 * are cheap: proposing writes two rows and touches Meta not at all.
 *
 * Scheduled at 23:00 UTC, which is 07:00 Manila: after the 06:00 UTC sync, so
 * it judges data that arrived a few hours earlier rather than yesterday's.
 * (vercel.json is strict JSON with a validated schema, so the schedule cannot
 * carry this note next to itself.)
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const rows = await db
    .select({ conn: integrationConnections, slug: brands.slug })
    .from(integrationConnections)
    .innerJoin(brands, eq(brands.id, integrationConnections.brandId))
    .where(
      and(
        eq(integrationConnections.platform, "meta"),
        eq(integrationConnections.status, "connected"),
      ),
    );

  const results: Record<string, unknown>[] = [];

  for (const { conn, slug } of rows) {
    const connection = conn as DbConnection;
    const currency = String(connection.config?.currency ?? "USD");
    const result: Record<string, unknown> = { brand: slug };

    // Each account is isolated: one brand's bad data or revoked token must not
    // stop the others being judged.
    try {
      result.rules = await runRules(connection, currency);
    } catch (err) {
      result.rulesError = err instanceof Error ? err.message : String(err);
    }

    // Straight after the rules, and before the sweep, so anything proposed this
    // morning is in the inbox by the time somebody reads the digest. It only
    // ever proposes; nothing here can apply a change.
    try {
      const proposal = await proposeFromAlerts(connection);
      result.proposed = proposal.proposed;
      if (proposal.skipped.length) result.proposalSkipped = proposal.skipped;
    } catch (err) {
      result.proposalError = err instanceof Error ? err.message : String(err);
    }

    try {
      const swept = await sweepActions(connection.id);
      result.actions = swept.length;
      if (swept.length) result.actionDetail = swept;
    } catch (err) {
      result.actionsError = err instanceof Error ? err.message : String(err);
    }

    try {
      const { stats, created } = await ensureDigest(connection, currency);
      result.digest = { created, ...stats };
    } catch (err) {
      result.digestError = err instanceof Error ? err.message : String(err);
    }

    results.push(result);
  }

  return Response.json({ ok: true, accounts: results.length, results });
}

// Vercel cron triggers GET by default; accept both, as the other cron routes do.
export const GET = POST;
