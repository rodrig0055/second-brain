import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, integrationConnections, knowledgeDocs } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { platformLabel } from "@/lib/platforms";
import { StatusBadge, ToneTag } from "@/components/status-badge";
import { freshnessOf, isoDay, type FreshnessState } from "@/lib/freshness";

// Daily cadence + margin: a connection is "stale" if its last successful sync is
// older than this. The daily cron runs at 06:00 UTC, so 26h tolerates a late
// tick without false alarms while still catching a genuinely missed day.
const STALE_HOURS = 26;

// Human-readable failure vocabulary written by sync.ts (classifyFailure).
const FAILURE_LABELS: Record<string, string> = {
  blocked_reauth_required: "Reconnect needed",
  blocked_provider_unavailable: "Provider unavailable",
  failed_validation: "Validation error",
};

function timeAgo(hours: number | null): string {
  if (hours === null) return "never synced";
  const h = Math.round(hours);
  if (h < 1) return "synced just now";
  if (h < 48) return `synced ${h}h ago`;
  return `synced ${Math.round(h / 24)}d ago`;
}

export default async function AdminHealthPage() {
  await requireAdmin();

  // "now" is taken from the DB (SQL now()) rather than an impure JS Date call,
  // so freshness is computed server-side in one query. Order doesn't matter —
  // rows are regrouped failing → stale → fresh below.
  const ageHours = sql<
    number | null
  >`extract(epoch from (now() - ${integrationConnections.lastSyncAt})) / 3600`;
  const conns = await db
    .select({
      id: integrationConnections.id,
      platform: integrationConnections.platform,
      displayName: integrationConnections.displayName,
      status: integrationConnections.status,
      syncError: integrationConnections.syncError,
      failureKind: integrationConnections.failureKind,
      recoveryAction: integrationConnections.recoveryAction,
      lastSyncAt: integrationConnections.lastSyncAt,
      brandName: brands.name,
      ageHours,
    })
    .from(integrationConnections)
    .leftJoin(brands, sql`${integrationConnections.brandId} = ${brands.id}`);

  const rows = conns.map((c) => {
    const age = c.ageHours === null ? null : Number(c.ageHours);
    const stale = age === null || age > STALE_HOURS;
    const failing = c.status === "error";
    const disconnected = c.status === "disconnected";
    return { c, age, stale, failing, disconnected };
  });

  const failing = rows.filter((r) => r.failing);
  const stale = rows.filter((r) => r.stale && !r.failing && !r.disconnected);
  const fresh = rows.filter((r) => !r.stale && !r.failing && !r.disconnected);
  const disconnected = rows.filter((r) => r.disconnected);

  // Brain freshness: the same question asked of the knowledge docs rather than
  // the connections. A doc past its cadence is trusted by the agent exactly as
  // much as a current one, which is the failure this panel exists to surface.
  const docs = await db
    .select({
      id: knowledgeDocs.id,
      title: knowledgeDocs.title,
      kind: knowledgeDocs.kind,
      updatedAt: knowledgeDocs.updatedAt,
      verifiedAt: knowledgeDocs.verifiedAt,
      metadata: knowledgeDocs.metadata,
      brandName: brands.name,
    })
    .from(knowledgeDocs)
    .leftJoin(brands, eq(knowledgeDocs.brandId, brands.id))
    .where(
      and(
        eq(knowledgeDocs.isActive, true),
        eq(knowledgeDocs.reviewState, "approved"),
      ),
    );

  const now = new Date();
  const docRows = docs
    .map((d) => ({ d, f: freshnessOf(d, now) }))
    .filter(({ f }) => f.state !== "evergreen")
    .sort((a, b) => (b.f.daysOverdue ?? 0) - (a.f.daysOverdue ?? 0));

  const byState = (s: FreshnessState) => docRows.filter((r) => r.f.state === s);
  const docsOverdue = byState("overdue");
  const docsDueSoon = byState("due-soon");
  const docsFresh = byState("fresh");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">
          Data health ({rows.length} connections)
        </h2>
        <div className="flex gap-2 text-xs">
          <ToneTag tone="success" label={`${fresh.length} fresh`} />
          <ToneTag tone="attention" label={`${stale.length} stale`} />
          <ToneTag tone="danger" label={`${failing.length} failing`} />
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Freshness of every connected data source. A source is <strong>stale</strong> when its last
        successful sync is over ~26h old (the cron runs daily), and <strong>failing</strong> when the
        last sync errored. Failures say <em>why</em> and what to do — the outage rarely costs much, the
        silence does. Note: GSC is read live from BigQuery (env-configured, not a connection) and is
        not tracked here.
      </p>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-card">
          No integration connections yet. Add them in{" "}
          <span className="font-medium">Integrations</span>.
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {[...failing, ...stale, ...fresh, ...disconnected].map(
            ({ c, age, stale, failing, disconnected }) => (
              <div
                key={c.id}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-700">
                    {c.brandName ?? "unknown brand"}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {platformLabel(c.platform)}
                    {c.displayName ? ` · ${c.displayName}` : ""}
                  </span>
                  {disconnected ? (
                    <StatusBadge status="disconnected" />
                  ) : failing ? (
                    <StatusBadge status="error" />
                  ) : stale ? (
                    <StatusBadge status="stale" />
                  ) : (
                    <StatusBadge status="active" />
                  )}
                  <span className="ml-auto text-xs text-zinc-400">
                    {timeAgo(age)}
                  </span>
                </div>
                {failing && (
                  <div className="mt-1.5 text-sm">
                    <span className="font-medium text-red-700">
                      {c.failureKind
                        ? (FAILURE_LABELS[c.failureKind] ?? c.failureKind)
                        : "Sync error"}
                    </span>
                    {c.recoveryAction && (
                      <p className="mt-0.5 text-xs text-zinc-600">
                        {c.recoveryAction}
                      </p>
                    )}
                    {c.syncError && (
                      <p className="mt-0.5 truncate text-xs text-zinc-400">
                        {c.syncError}
                      </p>
                    )}
                  </div>
                )}
                {stale && !failing && (
                  <p className="mt-1.5 text-xs text-amber-700">
                    No successful sync in over a day — check the connection and the daily cron.
                  </p>
                )}
              </div>
            ),
          )}
        </div>
      )}

      <div className="mt-10 flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">
          Brain freshness ({docRows.length} docs on a cadence)
        </h2>
        <div className="flex gap-2 text-xs">
          <ToneTag tone="success" label={`${docsFresh.length} fresh`} />
          <ToneTag tone="attention" label={`${docsDueSoon.length} due soon`} />
          <ToneTag tone="danger" label={`${docsOverdue.length} overdue`} />
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Knowledge docs go into every chat for their brand, and the agent trusts an
        old one exactly as much as a current one. Each kind carries a shelf life
        (catalog and offer rules 90 days, playbooks and winners 180, the weekly
        digest 7); &ldquo;as of&rdquo; is the last verification for AI-maintained
        docs and the last edit for human ones. Evergreen kinds — the master prompt,
        lessons, the index — are not listed. Override per doc with{" "}
        <code className="rounded bg-zinc-100 px-1">{`{"evergreen": true}`}</code> or{" "}
        <code className="rounded bg-zinc-100 px-1">{`{"refreshDays": 30}`}</code> in
        its metadata.
      </p>

      {docRows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-card">
          No knowledge docs on a refresh cadence yet.
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {docRows.map(({ d, f }) => (
            <div
              key={d.id}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-zinc-700">
                  {d.brandName ?? "global"}
                </span>
                <span className="text-xs text-zinc-500">
                  {d.title} · {d.kind}
                </span>
                {f.state === "overdue" ? (
                  <StatusBadge status="overdue" />
                ) : f.state === "due-soon" ? (
                  <StatusBadge status="due-soon" />
                ) : (
                  <StatusBadge status="active" />
                )}
                <span className="ml-auto text-xs text-zinc-400">
                  as of {isoDay(f.asOf)} · {f.cadenceDays}d cadence
                </span>
              </div>
              {f.state === "overdue" && f.daysOverdue !== null && (
                <p className="mt-1.5 text-xs text-red-700">
                  {f.daysOverdue === 0
                    ? "Due today"
                    : `${f.daysOverdue} day${f.daysOverdue === 1 ? "" : "s"} past its ${f.cadenceDays}-day shelf life`}
                  {" — the agent is still reading it as current."}
                </p>
              )}
              {f.state === "due-soon" && f.refreshBy && (
                <p className="mt-1.5 text-xs text-amber-700">
                  Due {isoDay(f.refreshBy)}.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
