import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { conversations, taskRuns, taskTemplates } from "@/db/schema";
import { requireTeam } from "@/lib/access";
import { PageHeader } from "@/components/page-header";
import { isChannelWorkspace, workspaceFor, workspaceHome } from "@/lib/workspaces";

export default async function TeamHomePage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team: teamSlug } = await params;
  const { user, team } = await requireTeam(teamSlug);

  // A channel workspace has its own landing surface; the generic team overview
  // is not where that specialist starts their day.
  // So does any workspace whose landing tab is a page of its own.
  const ws = workspaceFor(team.slug);
  const landingHref = ws.tabs.find((t) => t.key === ws.landing)?.href ?? "";
  if (isChannelWorkspace(team.slug) || landingHref !== "") redirect(workspaceHome(team.slug));

  const [recentChats, templates, recentRuns] = await Promise.all([
    db.query.conversations.findMany({
      where: and(
        eq(conversations.teamId, team.id),
        eq(conversations.userId, user.id),
      ),
      orderBy: [desc(conversations.updatedAt)],
      limit: 5,
      with: { brand: true },
    }),
    db.query.taskTemplates.findMany({
      where: and(
        eq(taskTemplates.teamId, team.id),
        eq(taskTemplates.isActive, true),
      ),
      limit: 6,
    }),
    db.query.taskRuns.findMany({
      where: and(
        eq(taskRuns.userId, user.id),
        inArray(
          taskRuns.templateId,
          db
            .select({ id: taskTemplates.id })
            .from(taskTemplates)
            .where(eq(taskTemplates.teamId, team.id)),
        ),
      ),
      orderBy: [desc(taskRuns.createdAt)],
      limit: 5,
      with: { template: true, brand: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader title="Overview" description={`Recent work in ${team.name}.`} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-sm font-medium text-zinc-700">
            Your recent chats
          </h2>
          <div className="mt-3 space-y-2">
            {recentChats.length === 0 && (
              <p className="text-sm text-zinc-500">No chats yet.</p>
            )}
            {recentChats.map((c) => (
              <Link
                key={c.id}
                href={`/chat/${c.id}`}
                className="block rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
              >
                <p className="truncate text-sm text-zinc-900">{c.title}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{c.brand.name}</p>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium text-zinc-700">AI tasks</h2>
          <div className="mt-3 space-y-2">
            {templates.length === 0 && (
              <p className="text-sm text-zinc-500">
                No task templates yet, an admin can add them.
              </p>
            )}
            {templates.map((t) => (
              <Link
                key={t.id}
                href={`/t/${team.slug}/tasks/${t.id}`}
                className="block rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
              >
                <p className="text-sm text-zinc-900">{t.name}</p>
                {t.description && (
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {t.description}
                  </p>
                )}
              </Link>
            ))}
          </div>
          {recentRuns.length > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              {recentRuns.length} recent output{recentRuns.length > 1 ? "s" : ""} in{" "}
              <Link
                href={`/t/${team.slug}/runs`}
                className="underline underline-offset-2 hover:text-zinc-700"
              >
                past outputs
              </Link>
              .
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
