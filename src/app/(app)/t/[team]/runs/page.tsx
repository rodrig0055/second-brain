import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { taskRuns, taskTemplates } from "@/db/schema";
import { requireTeam } from "@/lib/access";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialogButton } from "@/components/confirm-dialog-button";
import { deleteRun } from "./actions";

/** One line in the list. */
type Row = {
  key: string;
  title: string;
  subtitle: string;
  status: string;
  href: string;
  at: Date;
  /** What the confirmation says is about to disappear. A render takes its files with it. */
  deleteBody: string;
};

export default async function RunsPage({
  params,
}: {
  params: Promise<{ team: string }>;
}) {
  const { team: teamSlug } = await params;
  const { user, team } = await requireTeam(teamSlug);

  // Members see their own runs; admins see all runs for the team.
  const runs = await db.query.taskRuns.findMany({
    where: and(
      inArray(
        taskRuns.templateId,
        db
          .select({ id: taskTemplates.id })
          .from(taskTemplates)
          .where(eq(taskTemplates.teamId, team.id)),
      ),
      user.role === "admin" ? undefined : eq(taskRuns.userId, user.id),
    ),
    orderBy: [desc(taskRuns.createdAt)],
    limit: 100,
    with: { template: true, brand: true, user: true },
  });

  const when = (d: Date) =>
    new Date(d).toLocaleString("en-PH", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  const rows: Row[] = [
    ...runs.map<Row>((r) => ({
      key: r.id,
      title: r.template.name,
      subtitle: `${r.brand.name} \u00b7 ${when(r.createdAt)}${
        user.role === "admin" && r.user ? ` \u00b7 ${r.user.email}` : ""
      }`,
      status: r.status,
      href: `/t/${team.slug}/runs/${r.id}`,
      at: r.createdAt,
      deleteBody:
        "This deletes the record of that generation.",
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader title="Outputs" description="Review and reuse previously generated work." />

      <div className="space-y-2">
        {rows.length === 0 && (
          <EmptyState
            title="No outputs yet"
            description="Run an AI task and the saved result will appear here."
            action={
              <Button
                href={`/t/${team.slug}/tasks`}
                label="Browse tasks"
                variant="primary"
                size="sm"
              />
            }
          />
        )}
        {rows.map((r) => (
          /* The card is one big link, so the Retry and Delete controls cannot sit inside it \u2014 a
             link inside a link is invalid and the inner one stops being clickable. The card link is
             stretched over the row instead, and the controls sit above it. */
          <div
            key={r.key}
            className="relative flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
          >
            <Link
              href={r.href}
              className="absolute inset-0 rounded-lg"
              aria-label={`Open ${r.title}`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-900">{r.title}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{r.subtitle}</p>
            </div>
            <StatusBadge status={r.status} />
            <form
              id={`del-out-${r.key}`}
              action={deleteRun}
              className="hidden"
            >
              <input type="hidden" name="teamSlug" value={team.slug} />
              <input type="hidden" name="runId" value={r.key} />
            </form>
            <div className="relative shrink-0">
              <ConfirmDialogButton
                formId={`del-out-${r.key}`}
                label="Delete"
                title="Delete this output?"
                body={r.deleteBody}
                confirmLabel="Delete"
                tone="danger"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
