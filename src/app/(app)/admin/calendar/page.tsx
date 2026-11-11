import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

export default async function AdminCalendarPage() {
  await requireAdmin();
  const [rows, allBrands] = await Promise.all([
    db.query.calendarEvents.findMany(),
    db.query.brands.findMany({ orderBy: [asc(brands.name)] }),
  ]);
  const nameById = new Map(allBrands.map((b) => [b.id, b.name]));
  const scopeLabel = (ids: string[]) =>
    ids.length === 0
      ? "All brands"
      : ids.map((id) => nameById.get(id) ?? "unknown").join(", ");

  // Calendar order: sort by month/day so annual holidays read naturally,
  // regardless of the stored year.
  const sorted = [...rows].sort((a, b) =>
    a.date.slice(5).localeCompare(b.date.slice(5)),
  );

  const fmt = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">
          Calendar events ({rows.length})
        </h2>
        <Button
          href="/admin/calendar/new"
          label="New event"
          variant="primary"
          size="sm"
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Holidays, seasonal peaks, and campaign moments. Recent and upcoming
        events (−45 to +120 days) are injected into every chat and task prompt
        so the agent can plan ahead and explain past performance. Global events
        apply to all brands; set a brand for market-specific dates.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-400">
          No events yet.
        </p>
      ) : (
        <div className="mt-6 space-y-2">
          {sorted.map((e) => (
            <Link
              key={e.id}
              href={`/admin/calendar/${e.id}`}
              className="flex items-center gap-4 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
            >
              <span className="w-28 shrink-0 text-sm tabular-nums text-zinc-500">
                {fmt(e.date)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-900">{e.name}</p>
                <p className="mt-0.5 truncate text-xs text-zinc-500">
                  {scopeLabel(e.brandIds)}
                  {e.recurring ? " · repeats annually" : ""}
                  {e.notes ? ` · ${e.notes}` : ""}
                </p>
              </div>
              {!e.isActive && (
                <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                  inactive
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
