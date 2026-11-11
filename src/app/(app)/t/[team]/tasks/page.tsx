import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { taskTemplates } from "@/db/schema";
import { requireTeam } from "@/lib/access";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";

export default async function TasksPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team: teamSlug } = await params;
  const { user, team } = await requireTeam(teamSlug);

  const templates = await db.query.taskTemplates.findMany({
    where: and(
      eq(taskTemplates.teamId, team.id),
      eq(taskTemplates.isActive, true),
    ),
    orderBy: [asc(taskTemplates.name)],
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="AI tasks"
        description="Choose a workflow, provide the brief, and generate a brand-grounded result."
      />

      <div className="space-y-2">
        {templates.length === 0 && (
          <EmptyState
            title="No tasks are available yet"
            description={
              user.role === "admin"
                ? "A task is a template: a brief form and a prompt. Add one for this team."
                : "Ask an admin to add a task template for this team."
            }
            action={
              user.role === "admin" ? (
                <Button href="/admin/templates/new" label="New task template" variant="primary" />
              ) : undefined
            }
          />
        )}
        {templates.map((t) => (
          <Link
            key={t.id}
            href={`/t/${team.slug}/tasks/${t.id}`}
            className="block rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
          >
            <p className="font-medium text-zinc-900">{t.name}</p>
            {t.description && (
              <p className="mt-1 text-sm text-zinc-500">{t.description}</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
