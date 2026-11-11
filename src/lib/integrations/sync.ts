import { eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, syncRuns } from "@/db/schema";
import { getAdapter } from "./registry";
import type { DbConnection } from "./types";
import { windowFor } from "./window";

/**
 * Classify a sync error into an actionable failure kind + human recovery step.
 * The distinction that matters operationally: an expired credential will never
 * self-heal (a human must reconnect), a provider outage will (retry next tick),
 * and bad/validation data needs investigation. "The outage never costs you
 * much; the silence does" — so every failure says why it stopped and what to do.
 */
function classifyFailure(
  platform: string,
  message: string,
): { kind: string; recovery: string } {
  const m = message.toLowerCase();
  const reauth =
    /\b(401|403|unauthorized|forbidden|invalid[_ ]?grant|expired|reauth|re-auth|invalid[_ ]?token|token .*(expired|revoked|invalid)|access[_ ]?denied|authentication|credential)\b/.test(
      m,
    );
  if (reauth) {
    return {
      kind: "blocked_reauth_required",
      recovery: `Reconnect ${platform} for this brand in Settings → Integrations (the credential looks expired or revoked).`,
    };
  }
  const providerDown =
    /\b(429|too many requests|rate[_ ]?limit|timeout|timed out|etimedout|econnreset|econnrefused|enotfound|socket hang up|network|502|503|504|service unavailable|gateway|temporarily)\b/.test(
      m,
    );
  if (providerDown) {
    return {
      kind: "blocked_provider_unavailable",
      recovery: `Transient ${platform} error — it should recover on the next sync. Watch for repeats.`,
    };
  }
  return {
    kind: "failed_validation",
    recovery: `Sync ran but ${platform} returned an unexpected error — investigate the message; data may be malformed.`,
  };
}


/** Sync one connection end-to-end, recording a sync_runs row + connection status. */
export async function syncConnection(
  conn: DbConnection,
): Promise<{ ok: boolean; rowsWritten: number; error?: string }> {
  const adapter = getAdapter(conn.platform);
  if (!adapter) {
    return { ok: false, rowsWritten: 0, error: `No adapter for ${conn.platform}` };
  }
  const window = windowFor(
    conn,
    adapter.defaultLookbackDays,
    adapter.restateDays,
  );
  const [run] = await db
    .insert(syncRuns)
    .values({
      connectionId: conn.id,
      brandId: conn.brandId,
      platform: conn.platform,
      status: "running",
      windowStart: window.start,
      windowEnd: window.end,
    })
    .returning();

  try {
    const { rowsWritten } = await adapter.sync(conn, window);
    const now = new Date();
    await db
      .update(syncRuns)
      .set({ status: "done", rowsWritten, finishedAt: now })
      .where(eq(syncRuns.id, run.id));
    await db
      .update(integrationConnections)
      .set({
        lastSyncAt: now,
        lastSyncStatus: "done",
        syncError: null,
        failureKind: null,
        recoveryAction: null,
        status: "connected",
        updatedAt: now,
      })
      .where(eq(integrationConnections.id, conn.id));
    return { ok: true, rowsWritten };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const { kind, recovery } = classifyFailure(conn.platform, message);
    const now = new Date();
    await db
      .update(syncRuns)
      .set({
        status: "error",
        errorMessage: message,
        failureKind: kind,
        recoveryAction: recovery,
        finishedAt: now,
      })
      .where(eq(syncRuns.id, run.id));
    await db
      .update(integrationConnections)
      .set({
        lastSyncStatus: "error",
        syncError: message,
        failureKind: kind,
        recoveryAction: recovery,
        status: "error",
        updatedAt: now,
      })
      .where(eq(integrationConnections.id, conn.id));
    return { ok: false, rowsWritten: 0, error: message };
  }
}

/** Sync every connected integration. Per-connection isolation: one failure
 *  never blocks the rest. Called by the daily cron and the "Sync now" button. */
export async function syncAllConnections(): Promise<{ synced: number; failed: number }> {
  // Retry errored connections too; only skip ones explicitly disconnected.
  const conns = await db.query.integrationConnections.findMany({
    where: ne(integrationConnections.status, "disconnected"),
  });
  let synced = 0;
  let failed = 0;
  for (const conn of conns) {
    const r = await syncConnection(conn);
    if (r.ok) synced++;
    else failed++;
  }
  return { synced, failed };
}
