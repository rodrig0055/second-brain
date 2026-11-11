import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { taskTemplates } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

export default async function AdminTemplatesPage() {
  await requireAdmin();
  const templates = await db.query.taskTemplates.findMany({
    orderBy: [asc(taskTemplates.name)],
    with: { team: { with: { department: true } } },
  });

  // Group department -> team -> templates, all alphabetical.
  type Tpl = (typeof templates)[number];
  const departments = new Map<
    string,
    { name: string; teams: Map<string, { name: string; slug: string; items: Tpl[] }> }
  >();
  for (const t of templates) {
    const dept = t.team.department;
    if (!departments.has(dept.id)) {
      departments.set(dept.id, { name: dept.name, teams: new Map() });
    }
    const teams = departments.get(dept.id)!.teams;
    if (!teams.has(t.team.id)) {
      teams.set(t.team.id, { name: t.team.name, slug: t.team.slug, items: [] });
    }
    teams.get(t.team.id)!.items.push(t);
  }
  const grouped = [...departments.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({
      name: d.name,
      teams: [...d.teams.values()].sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">
          Task templates ({templates.length})
        </h2>
        <Button
          href="/admin/templates/new"
          label="New template"
          variant="primary"
          size="sm"
        />
      </div>

      {templates.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500">No task templates yet.</p>
      )}

      <div className="mt-6 space-y-8">
        {grouped.map((dept) => (
          <section key={dept.name}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              {dept.name}
            </h3>
            <div className="mt-3 space-y-5">
              {dept.teams.map((team) => (
                <div key={team.slug}>
                  <div className="flex items-baseline gap-2 px-1">
                    <p className="text-sm font-medium text-zinc-700">
                      {team.name}
                    </p>
                    <span className="text-xs text-zinc-400">
                      {team.items.length} template
                      {team.items.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {team.items.map((t) => (
                      <Link
                        key={t.id}
                        href={`/admin/templates/${t.id}`}
                        className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-zinc-900">{t.name}</p>
                          <p className="mt-0.5 truncate text-xs text-zinc-500">
                            {t.model}
                            {t.description ? ` · ${t.description}` : ""}
                          </p>
                        </div>
                        {!t.isActive && (
                          <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">
                            inactive
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
