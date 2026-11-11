import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { wikiActivity } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { StatusBadge } from "@/components/status-badge";

const OP_LABELS: Record<string, string> = {
  reflection: "Reflection",
  ingest: "Ingest",
  lint: "Lint",
  index: "Index",
};

// Action → tone for the small action pill.
const ACTION_STYLES: Record<string, string> = {
  created: "bg-emerald-50 text-emerald-700",
  approved: "bg-emerald-50 text-emerald-700",
  updated: "bg-blue-50 text-blue-600",
  replaced: "bg-amber-50 text-amber-700",
  superseded: "bg-amber-50 text-amber-700",
  deactivated: "bg-amber-50 text-amber-700",
  flagged: "bg-amber-50 text-amber-700",
  error: "bg-red-50 text-red-600",
  "no-lesson": "bg-zinc-100 text-zinc-500",
  skipped: "bg-zinc-100 text-zinc-500",
  regenerated: "bg-zinc-100 text-zinc-500",
};

export default async function AdminWikiPage() {
  await requireAdmin();
  const rows = await db.query.wikiActivity.findMany({
    orderBy: [desc(wikiActivity.createdAt)],
    limit: 200,
    with: { brand: true, team: true, doc: true },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">
          Wiki activity ({rows.length})
        </h2>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Every decision the AI wiki makes: lessons captured from chats
        (reflection), weekly data digests (ingest), and health checks (lint).
        Click through to a doc to edit or deactivate it — deactivating is how
        you prune a bad lesson; the AI never reactivates an admin-pruned doc.
      </p>

      {rows.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-card">
          No wiki activity yet. Lessons appear here after substantive chats;
          ingest and lint run weekly (Tuesdays).
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-zinc-700">
                  {OP_LABELS[r.op] ?? r.op}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${ACTION_STYLES[r.action] ?? "bg-zinc-100 text-zinc-600"}`}
                >
                  {r.action}
                </span>
                <span className="text-xs text-zinc-500">
                  {r.brand?.name ?? "unknown brand"}
                  {r.team ? ` · ${r.team.name}` : ""}
                </span>
                {r.status !== "done" && <StatusBadge status={r.status} />}
                <span className="ml-auto text-xs text-zinc-400">
                  {new Date(r.createdAt).toLocaleString("en-PH", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              {(r.doc || r.detail) && (
                <div className="mt-1.5 text-sm">
                  {r.doc ? (
                    <Link
                      href={`/admin/knowledge/${r.doc.id}`}
                      className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500"
                    >
                      {r.doc.title}
                    </Link>
                  ) : r.docId ? (
                    <span className="text-zinc-400">(doc deleted)</span>
                  ) : null}
                  {r.detail && (
                    <p className="mt-0.5 text-xs text-zinc-500">{r.detail}</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
