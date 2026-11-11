import { asc } from "drizzle-orm";
import { db } from "@/db";
import { departments, teams } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import {
  createDepartment,
  createTeam,
  deleteDepartment,
  deleteTeam,
} from "./actions";
import { ConfirmDeleteForm } from "./confirm-delete-form";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Button } from "@astryxdesign/core/Button";

export default async function AdminTeamsPage() {
  await requireAdmin();
  const [allDepartments, allTeams] = await Promise.all([
    db.query.departments.findMany({ orderBy: [asc(departments.name)] }),
    db.query.teams.findMany({
      orderBy: [asc(teams.name)],
      with: { department: true },
    }),
  ]);

  const inputCls =
    "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none";

  const teamCount = (deptId: string) =>
    allTeams.filter((t) => t.departmentId === deptId).length;

  return (
    <div className="space-y-12">
      {/* Departments */}
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-zinc-700">
            Departments ({allDepartments.length})
          </h2>
          <ActionSheet
            label="Add department"
            title="Add department"
            description="Departments are the top-level groups in the sidebar (e.g. Marketing, Commercial). Slug is generated from the name if left blank."
            variant="secondary"
          >
            <form action={createDepartment} className="grid gap-4">
              <label className="flex flex-col gap-1 text-xs text-zinc-600 [&>input]:w-full [&>select]:w-full">
                Name
                <input
                  name="name"
                  required
                  placeholder="e.g. Operations"
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-600 [&>input]:w-full [&>select]:w-full">
                Slug (optional)
                <input
                  name="slug"
                  placeholder="operations"
                  className={inputCls}
                />
              </label>
              <Button
                label="Add department"
                variant="primary"
                type="submit"
                className="justify-self-start"
              />
            </form>
          </ActionSheet>
        </div>

        <div className="mt-4 space-y-2">
          {allDepartments.map((d) => {
            const count = teamCount(d.id);
            return (
              <div
                key={d.id}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-zinc-900">{d.name}</p>
                  <p className="text-xs text-zinc-500">
                    /{d.slug} · {count} team{count === 1 ? "" : "s"}
                  </p>
                </div>
                {count === 0 ? (
                  <ConfirmDeleteForm
                    action={deleteDepartment}
                    id={d.id}
                    message={`Delete the "${d.name}" department? This can't be undone.`}
                  />
                ) : (
                  <span className="text-xs text-zinc-400">
                    Remove its teams first
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Teams */}
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-zinc-700">
            Teams ({allTeams.length})
          </h2>
          <ActionSheet
            label="Add team"
            title="Add team"
            description="Teams are the groups under a department (e.g. a “Channel” team under Commercial). They appear in the sidebar and have their own chat, tasks, and knowledge."
            variant="secondary"
          >
            <form action={createTeam} className="grid gap-4">
              <label className="flex flex-col gap-1 text-xs text-zinc-600 [&>input]:w-full [&>select]:w-full">
                Department
                <select name="departmentId" required className={inputCls}>
                  {allDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-600 [&>input]:w-full [&>select]:w-full">
                Name
                <input
                  name="name"
                  required
                  placeholder="e.g. Channel"
                  className={inputCls}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-zinc-600 [&>input]:w-full [&>select]:w-full">
                Slug (optional)
                <input name="slug" placeholder="channel" className={inputCls} />
              </label>
              <Button
                label="Add team"
                variant="primary"
                type="submit"
                isDisabled={allDepartments.length === 0}
                className="justify-self-start"
              />
            </form>
          </ActionSheet>
        </div>

        <div className="mt-4 space-y-2">
          {allTeams.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="text-zinc-900">{t.name}</p>
                <p className="text-xs text-zinc-500">
                  {t.department.name} · /t/{t.slug}
                </p>
              </div>
              <ConfirmDeleteForm
                action={deleteTeam}
                id={t.id}
                title="Deletes this team and its templates, chats, and knowledge docs"
                message={`Delete the "${t.name}" team? This also deletes its task templates, chats, and knowledge docs. This can't be undone.`}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
