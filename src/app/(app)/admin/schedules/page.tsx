import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { brands, scheduledTasks, taskTemplates } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { deleteSchedule, toggleSchedule } from "./actions";
import { ScheduleForm } from "./schedule-form";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { Button } from "@astryxdesign/core/Button";
import { ActionSheet } from "@/components/ui/action-sheet";

export default async function AdminSchedulesPage() {
  await requireAdmin();

  const [schedules, templates, allBrands] = await Promise.all([
    db.query.scheduledTasks.findMany({
      orderBy: [desc(scheduledTasks.createdAt)],
      with: { template: true, brand: true },
    }),
    db.query.taskTemplates.findMany({
      where: (t, { eq }) => eq(t.isActive, true),
      orderBy: [asc(taskTemplates.name)],
    }),
    db.query.brands.findMany({ orderBy: [asc(brands.name)] }),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-zinc-700">
          Scheduled tasks ({schedules.length})
        </h2>
        <ActionSheet
          label="New schedule"
          title="New schedule"
          description="Runs the task every morning, or every Monday, for one brand."
        >
          <ScheduleForm
            templates={templates.map((t) => ({
              id: t.id,
              name: t.name,
              inputFields: t.inputFields,
            }))}
            brands={allBrands.map((b) => ({ id: b.id, name: b.name }))}
          />
        </ActionSheet>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Scheduled tasks run automatically each morning (around 2 PM Manila
        time). “Every day” runs daily; “Every Monday” runs once a week. The
        results show up under the team’s outputs.
      </p>

      <div className="mt-4 space-y-2">
        {schedules.length === 0 && (
          <p className="text-sm text-zinc-500">No schedules yet.</p>
        )}
        {schedules.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-900">{s.template.name}</p>
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {s.brand.name} ·{" "}
                {s.frequency === "weekly" ? "Every Monday" : "Every day"}
                {s.lastRunAt
                  ? ` · last ran ${new Date(s.lastRunAt).toLocaleString("en-PH")}`
                  : " · never run"}
              </p>
            </div>
            <form action={toggleSchedule}>
              <input type="hidden" name="id" value={s.id} />
              <input type="hidden" name="isActive" value={String(s.isActive)} />
              <Button
                label={s.isActive ? "Active" : "Paused"}
                variant="ghost"
                size="sm"
                type="submit"
              />
            </form>
            <form action={deleteSchedule}>
              <input type="hidden" name="id" value={s.id} />
              <ConfirmSubmitButton
                message={`Delete the ${s.template.name} schedule? This cannot be undone.`}
                label="Delete"
              />
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
