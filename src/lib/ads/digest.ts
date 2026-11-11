/**
 * The morning digest: yesterday against target, what tripped, what is waiting.
 *
 * Built deterministically from stored numbers, with no model involved. The team
 * is judged on these figures, so the same day must always produce the same
 * digest, and anyone should be able to rebuild it by hand from the same rows.
 *
 * Stored per account per day rather than recomputed on demand, because it is a
 * record of what the team was told on a given morning. Meta keeps restating
 * recent days, so recomputing last Tuesday's digest today would quietly rewrite
 * history, and "what did we know on Tuesday" is exactly the question asked
 * after a decision turns out badly.
 */
import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adActions, adAlerts, adDigests, adDrafts, adRules } from "@/db/schema";
import type { DbConnection } from "@/lib/integrations/types";
import { loadDailyTracker } from "./store";
import type { Funnel } from "./funnel";

export type DigestSection = { heading: string; body: string };
export type Digest = { title: string; sections: DigestSection[] };

export type DigestStats = {
  date: string;
  spend: number;
  purchases: number;
  cir: number | null;
  openAlerts: number;
  criticalAlerts: number;
  pendingActions: number;
  failedToRun: number;
  draftsPending: number;
  unmappedSpend: number;
};

function money(value: number, currency: string): string {
  return `${currency} ${value.toFixed(2)}`;
}

/** Yesterday in the ad account's timezone, which is not always UTC's. */
export function accountToday(timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function previousDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * CIR targets by funnel, read from the configured rules rather than hardcoded,
 * so the digest and the alerts cannot disagree about what "on target" means.
 */
async function targetsFor(
  connectionId: string,
): Promise<Map<string, { target: number; confirmed: boolean }>> {
  const rules = await db
    .select()
    .from(adRules)
    .where(
      and(
        eq(adRules.connectionId, connectionId),
        eq(adRules.kind, "cir_over_target"),
      ),
    );
  const out = new Map<string, { target: number; confirmed: boolean }>();
  for (const rule of rules) {
    const target = (rule.params as Record<string, number>)?.targetPct;
    if (target === undefined) continue;
    for (const funnel of (rule.funnels ?? []) as string[]) {
      out.set(funnel, { target, confirmed: rule.confirmedAt !== null });
    }
  }
  return out;
}

export async function buildDigest(
  conn: DbConnection,
  currency: string,
): Promise<{ digest: Digest; stats: DigestStats }> {
  const timezone = String(conn.config?.timezone ?? "UTC");
  const date = previousDay(accountToday(timezone));

  const tracker = await loadDailyTracker({
    connectionId: conn.id,
    brandId: conn.brandId,
    range: { start: date, end: date },
  });
  const total = tracker.find((r) => r.funnel === "TOTAL");
  const funnelRows = tracker.filter(
    (r) => r.funnel !== "TOTAL" && r.funnel !== "UNMAPPED",
  );
  const unmapped = tracker.filter((r) => r.funnel === "UNMAPPED");
  const targets = await targetsFor(conn.id);

  const [alerts, actions, drafts] = await Promise.all([
    db
      .select()
      .from(adAlerts)
      .where(
        and(
          eq(adAlerts.connectionId, conn.id),
          inArray(adAlerts.state, ["open"]),
        ),
      ),
    db
      .select()
      .from(adActions)
      .where(
        and(
          eq(adActions.connectionId, conn.id),
          inArray(adActions.state, ["pending", "failed"]),
        ),
      ),
    db
      .select()
      .from(adDrafts)
      .where(
        and(
          eq(adDrafts.connectionId, conn.id),
          inArray(adDrafts.status, ["requested", "ready_to_run", "failed_to_run"]),
        ),
      ),
  ]);

  const sections: DigestSection[] = [];

  // --- yesterday ---
  if (!total) {
    sections.push({
      heading: "Yesterday",
      body: `No data synced for ${date}. The sync may not have run.`,
    });
  } else {
    const t = total.totals;
    const cirText =
      t.purchaseValue > 0 ? `${t.cir.toFixed(0)}% CIR` : "no revenue, so no CIR";
    const lines = [
      `${money(t.spend, currency)} spent, ${t.purchases} purchase${t.purchases === 1 ? "" : "s"}, ` +
        `${money(t.purchaseValue, currency)} back. ${cirText}.`,
    ];
    for (const row of funnelRows) {
      const target = targets.get(row.funnel);
      const cir = row.totals.purchaseValue > 0 ? row.totals.cir : null;
      const verdict =
        cir === null
          ? "no purchases"
          : target
            ? cir > target.target
              ? `${cir.toFixed(0)}% against a ${target.target}% target — over`
              : `${cir.toFixed(0)}% against a ${target.target}% target — on target`
            : `${cir.toFixed(0)}%, no target set`;
      lines.push(
        `${row.funnel}: ${money(row.totals.spend, currency)}, ${verdict}.`,
      );
    }
    sections.push({ heading: "Yesterday", body: lines.join("\n") });
  }

  // --- gaps that make the numbers wrong rather than bad ---
  const unmappedSpend = unmapped.reduce((sum, r) => sum + r.totals.spend, 0);
  if (unmappedSpend > 0) {
    sections.push({
      heading: "Unmapped spend",
      body:
        `${money(unmappedSpend, currency)} belongs to no funnel, so every funnel ` +
        "figure above is missing it. Map those ad sets and the totals close.",
    });
  }

  // --- what tripped ---
  const critical = alerts.filter((a) => a.severity === "critical");
  if (alerts.length > 0) {
    const top = [...critical, ...alerts.filter((a) => a.severity !== "critical")]
      .slice(0, 8)
      .map((a) => `${a.entityName}: ${a.message}`);
    sections.push({
      heading: `Alerts (${alerts.length}, ${critical.length} critical)`,
      body: top.join("\n"),
    });
  }

  // --- what is waiting on a person ---
  const pending = actions.filter((a) => a.state === "pending");
  const failed = actions.filter((a) => a.state === "failed");
  if (pending.length > 0 || failed.length > 0) {
    const lines = [];
    if (pending.length) {
      lines.push(
        `${pending.length} change${pending.length === 1 ? "" : "s"} waiting for approval.`,
      );
    }
    if (failed.length) {
      lines.push(
        `${failed.length} failed and need looking at: ` +
          failed.slice(0, 3).map((a) => `${a.entityName} (${a.error ?? "no detail"})`).join("; "),
      );
    }
    sections.push({ heading: "Waiting for you", body: lines.join("\n") });
  }

  // --- ads that never ran ---
  const failedToRun = alerts.filter((a) => a.kind === "failed_to_run");
  if (failedToRun.length > 0) {
    sections.push({
      heading: "Uploaded but not spending",
      body:
        failedToRun.map((a) => a.entityName).join(", ") +
        "\nMeta is not delivering these. They usually need their own ad set.",
    });
  }

  // --- the pipeline ---
  if (drafts.length > 0) {
    const byStatus = new Map<string, number>();
    for (const d of drafts) {
      byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);
    }
    sections.push({
      heading: "Ads in the pipeline",
      body: [...byStatus.entries()]
        .map(([status, count]) => `${count} ${status.replace(/_/g, " ")}`)
        .join(", "),
    });
  }

  const stats: DigestStats = {
    date,
    spend: total?.totals.spend ?? 0,
    purchases: total?.totals.purchases ?? 0,
    cir:
      total && total.totals.purchaseValue > 0 ? total.totals.cir : null,
    openAlerts: alerts.length,
    criticalAlerts: critical.length,
    pendingActions: pending.length,
    failedToRun: failedToRun.length,
    draftsPending: drafts.length,
    unmappedSpend,
  };

  return {
    digest: {
      title: `Meta ads · ${date}`,
      sections: sections.length
        ? sections
        : [{ heading: "Quiet", body: "Nothing tripped and nothing is waiting." }],
    },
    stats,
  };
}

/**
 * Build and store today's digest if it is not already there.
 *
 * Idempotent through the unique index on (connection, date), so the page open
 * and the cron can both call it and only the first writes. Returns what is
 * stored either way.
 */
export async function ensureDigest(
  conn: DbConnection,
  currency: string,
): Promise<{ digest: Digest; stats: DigestStats; created: boolean }> {
  const timezone = String(conn.config?.timezone ?? "UTC");
  const date = previousDay(accountToday(timezone));

  const existing = await db.query.adDigests.findFirst({
    where: and(eq(adDigests.connectionId, conn.id), eq(adDigests.date, date)),
  });
  if (existing) {
    return {
      digest: existing.report as unknown as Digest,
      stats: existing.stats as unknown as DigestStats,
      created: false,
    };
  }

  const { digest, stats } = await buildDigest(conn, currency);
  await db
    .insert(adDigests)
    .values({
      connectionId: conn.id,
      brandId: conn.brandId,
      date,
      report: digest as unknown as Record<string, unknown>,
      stats: stats as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing();

  return { digest, stats, created: true };
}

/** Recent digests, for the history strip on the cockpit. */
export async function recentDigests(
  connectionId: string,
  limit = 7,
): Promise<{ date: string; stats: DigestStats }[]> {
  // Ordered in SQL, not after the limit: sorting the rows the limit happened to
  // return gives you seven arbitrary days in date order, not the last seven.
  const rows = await db
    .select()
    .from(adDigests)
    .where(eq(adDigests.connectionId, connectionId))
    .orderBy(desc(adDigests.date))
    .limit(limit);
  return rows.map((r) => ({ date: r.date, stats: r.stats as unknown as DigestStats }));
}

/** Yesterday's digest, for the panel that shows it. */
export async function latestDigest(
  connectionId: string,
): Promise<{ date: string; report: Digest; stats: DigestStats } | null> {
  const [row] = await db
    .select()
    .from(adDigests)
    .where(eq(adDigests.connectionId, connectionId))
    .orderBy(desc(adDigests.date))
    .limit(1);
  if (!row) return null;
  return {
    date: row.date,
    report: row.report as unknown as Digest,
    stats: row.stats as unknown as DigestStats,
  };
}

export type { Funnel };
