import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { brands, competitors } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

export default async function AdminCompetitorsPage() {
  await requireAdmin();
  const [rows, allBrands] = await Promise.all([
    db.query.competitors.findMany({ orderBy: [asc(competitors.name)] }),
    db.query.brands.findMany({ orderBy: [asc(brands.name)] }),
  ]);
  const nameById = new Map(allBrands.map((b) => [b.id, b.name]));
  const scopeLabel = (ids: string[]) =>
    ids.length === 0
      ? "All brands"
      : ids.map((id) => nameById.get(id) ?? "unknown").join(", ");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">
          Competitors ({rows.length})
        </h2>
        <Button
          href="/admin/competitors/new"
          label="New competitor"
          variant="primary"
          size="sm"
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Injected into every chat and task prompt for the brands they apply to,
        so the agent knows who it competes against. Domains double as targets for
        SERP / Ahrefs competitor analysis. Assign one or more brands, or none for
        all brands.
      </p>

      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-dashed border-zinc-200 px-4 py-8 text-center text-sm text-zinc-400">
          No competitors yet.
        </p>
      ) : (
        <div className="mt-6 space-y-2">
          {rows.map((c) => (
            <Link
              key={c.id}
              href={`/admin/competitors/${c.id}`}
              className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm text-zinc-900">{c.name}</p>
                <p className="mt-0.5 truncate text-xs text-zinc-500">
                  {scopeLabel(c.brandIds)}
                  {c.domain ? ` · ${c.domain}` : ""}
                </p>
              </div>
              {!c.isActive && (
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
