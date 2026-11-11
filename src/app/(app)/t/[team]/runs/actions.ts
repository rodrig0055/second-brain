"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taskRuns } from "@/db/schema";
import { requireTeam } from "@/lib/access";

/**
 * Throw one output away from the Outputs list. Authorisation re-derives the list's own rule:
 * the run belongs to a template on this team, and non-admins can only delete their own.
 */
export async function deleteRun(formData: FormData) {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const runId = String(formData.get("runId") ?? "");
  const { user, team } = await requireTeam(teamSlug);

  const run = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, runId),
    with: { template: true },
  });
  if (!run || run.template.teamId !== team.id) return;
  if (user.role !== "admin" && run.userId !== user.id) return;

  await db.delete(taskRuns).where(eq(taskRuns.id, runId));
  revalidatePath(`/t/${team.slug}/runs`);
}
