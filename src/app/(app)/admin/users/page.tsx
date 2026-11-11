import { asc } from "drizzle-orm";
import { db } from "@/db";
import { brands, teams, users } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { addUser, removeUser, updateUser } from "./actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Button } from "@astryxdesign/core/Button";

export default async function AdminUsersPage() {
  const admin = await requireAdmin();
  const [allUsers, allTeams, allBrands] = await Promise.all([
    db.query.users.findMany({
      orderBy: [asc(users.createdAt)],
      with: { teamAccess: true, brandAccess: true },
    }),
    db.query.teams.findMany({ orderBy: [asc(teams.name)] }),
    db.query.brands.findMany({ orderBy: [asc(brands.name)] }),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-zinc-700">
            Users ({allUsers.length})
          </h2>
          <ActionSheet
            label="Add user"
            title="Add user"
            description="Only emails added here can sign in with Google."
          >
            <form action={addUser} className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs text-zinc-600">
                  Email
                  <input
                    name="email"
                    type="email"
                    required
                    placeholder="name@acmeflorals.example"
                    className="w-64 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-zinc-600">
                  Role
                  <select
                    name="role"
                    defaultValue="member"
                    className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </label>
                <Button label="Add user" variant="primary" type="submit" />
              </div>
              <div className="mt-3">
                <p className="text-xs text-zinc-500">Teams</p>
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {allTeams.map((t) => (
                    <label
                      key={t.id}
                      className="flex items-center gap-1.5 text-sm text-zinc-700"
                    >
                      <input type="checkbox" name="teamIds" value={t.id} />
                      {t.name}
                    </label>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <p className="text-xs text-zinc-500">Brands</p>
                <div className="mt-1.5 flex flex-wrap gap-3">
                  {allBrands.map((b) => (
                    <label
                      key={b.id}
                      className="flex items-center gap-1.5 text-sm text-zinc-700"
                    >
                      <input type="checkbox" name="brandIds" value={b.id} />
                      {b.name}
                    </label>
                  ))}
                </div>
              </div>
            </form>
          </ActionSheet>
        </div>
        <div className="mt-4 space-y-3">
          {allUsers.map((u) => {
            const granted = new Set(u.teamAccess.map((a) => a.teamId));
            const grantedBrands = new Set(u.brandAccess.map((a) => a.brandId));
            const isSelf = u.id === admin.id;
            return (
              <div
                key={u.id}
                className="rounded-xl border border-zinc-200 bg-white p-4"
              >
                <form
                  action={updateUser}
                  className="flex flex-wrap items-center gap-4"
                >
                  <input type="hidden" name="userId" value={u.id} />
                  <div className="min-w-48">
                    <p className="text-sm text-zinc-900">
                      {u.name ?? "(not signed in yet)"}
                      {isSelf && (
                        <span className="ml-2 text-xs text-zinc-500">you</span>
                      )}
                    </p>
                    <p className="text-xs text-zinc-500">{u.email}</p>
                  </div>
                  <select
                    name="role"
                    defaultValue={u.role}
                    disabled={isSelf}
                    className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm text-zinc-900 disabled:opacity-50"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-zinc-500">Teams</span>
                      {allTeams.map((t) => (
                        <label
                          key={t.id}
                          className="flex items-center gap-1.5 text-sm text-zinc-700"
                        >
                          <input
                            type="checkbox"
                            name="teamIds"
                            value={t.id}
                            defaultChecked={granted.has(t.id)}
                          />
                          {t.name}
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs text-zinc-500">Brands</span>
                      {allBrands.map((b) => (
                        <label
                          key={b.id}
                          className="flex items-center gap-1.5 text-sm text-zinc-700"
                        >
                          <input
                            type="checkbox"
                            name="brandIds"
                            value={b.id}
                            defaultChecked={grantedBrands.has(b.id)}
                          />
                          {b.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <Button label="Save" size="sm" type="submit" />
                </form>
                {!isSelf && (
                  <form action={removeUser} className="mt-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <ConfirmSubmitButton
                      message={`Remove ${u.email}? They will lose access immediately.`}
                      label="Remove user"
                    />
                  </form>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Admins automatically have access to every team and brand. Team and
          brand checkboxes apply to members.
        </p>
      </section>
    </div>
  );
}
