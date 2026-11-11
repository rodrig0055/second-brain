import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

export default async function AdminKnowledgePage() {
  await requireAdmin();
  const docs = await db.query.knowledgeDocs.findMany({
    orderBy: [desc(knowledgeDocs.updatedAt)],
    with: { brand: true, team: true },
  });

  const groups = new Map<string, typeof docs>();
  for (const d of docs) {
    const key = d.brand?.name ?? "Global";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">
          Knowledge docs ({docs.length})
        </h2>
        <Button
          href="/admin/knowledge/new"
          label="New doc"
          variant="primary"
          size="sm"
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        These docs are injected into every chat and task prompt for their brand
        and team. Brand voice + offer rules are the keystone, write those
        first.
      </p>

      <div className="mt-6 space-y-8">
        {[...groups.entries()].map(([brandName, brandDocs]) => (
          <section key={brandName}>
            <h3 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
              {brandName}
            </h3>
            <div className="mt-2 space-y-2">
              {brandDocs.map((d) => (
                <Link
                  key={d.id}
                  href={`/admin/knowledge/${d.id}`}
                  className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-900">{d.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {d.kind}
                      {d.team ? ` · ${d.team.name}` : " · brand-wide"} · updated{" "}
                      {new Date(d.updatedAt).toLocaleDateString("en-PH", {
                        month: "short",
                        day: "numeric",
                      })}
                    </p>
                  </div>
                  {!d.isActive && (
                    <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                      inactive
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
