import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taskRuns } from "@/db/schema";
import { requireTeam } from "@/lib/access";
import { reportSchema } from "@/lib/reports/schema";
import { MessagesSquare } from "lucide-react";
import { startChatFromRun } from "@/app/(app)/chat/actions";
import { OutputActions } from "@/components/output-actions";
import { TaskOutput } from "@/components/task-output";
import { ReportView } from "@/components/report-view";
import { ReviewReceipt } from "@/components/review-receipt";
import type { ReviewResult } from "@/lib/review/review";

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function inputLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ team: string; id: string }>;
}) {
  const { team: teamSlug, id } = await params;
  const { user, team } = await requireTeam(teamSlug);

  const run = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, id),
    with: { template: true, brand: true },
  });
  if (
    !run ||
    run.template.teamId !== team.id ||
    (run.userId !== user.id && user.role !== "admin")
  ) {
    notFound();
  }

  const filename = `${run.template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${run.brand.slug}.md`;

  // Report templates store a JSON blob rendered as cards; fall back to markdown
  // if it doesn't parse (e.g. an older run).
  const report =
    run.template.renderAs === "report" && run.status === "done"
      ? reportSchema.safeParse(safeJson(run.output))
      : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <Link
        href={`/t/${team.slug}/runs`}
        className="text-sm text-zinc-500 hover:text-zinc-700"
      >
        ← All outputs
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">
        {run.template.name}
      </h1>
      <p className="mt-1 text-sm text-zinc-600">
        {run.brand.name} · {run.model} ·{" "}
        {new Date(run.createdAt).toLocaleString("en-PH")}
      </p>

      {Object.keys(run.inputs).length > 0 && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Inputs
          </p>
          <dl className="mt-2 space-y-1">
            {Object.entries(run.inputs).map(([k, v]) => (
              <div key={k} className="flex gap-2 text-sm">
                <dt className="shrink-0 text-zinc-500">{inputLabel(k)}:</dt>
                <dd className="min-w-0 wrap-anywhere text-zinc-700">{v || "N/A"}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div
        className={
          report?.success
            ? "mt-8"
            : "mt-6 rounded-xl border border-zinc-200 bg-white p-4 sm:p-6"
        }
      >
        {run.status === "error" ? (
          <div className="text-sm text-red-500">
            <p className="font-medium">This run failed.</p>
            {run.output && <p className="mt-1 text-red-500/90">{run.output}</p>}
          </div>
        ) : run.status === "running" ? (
          <p className="text-sm text-zinc-600">
            Still generating (or interrupted), refresh in a moment.
          </p>
        ) : (
          <>
            {report && report.success ? (
              <ReportView data={report.data} />
            ) : (
              <TaskOutput>{run.output}</TaskOutput>
            )}
            <ReviewReceipt
              review={(run.review as ReviewResult | null) ?? null}
            />
            <div className="mt-6 space-y-4 border-t border-zinc-200 pt-4">
              <form action={startChatFromRun}>
                <input type="hidden" name="runId" value={run.id} />
                <Button
                  type="submit"
                  label="Continue in chat"
                  variant="primary"
                  icon={<MessagesSquare className="size-full" aria-hidden />}
                />
                <p className="mt-1.5 text-xs text-zinc-500">
                  Opens a chat preloaded with this task and its output.
                </p>
              </form>
              <OutputActions output={run.output} filename={filename} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
