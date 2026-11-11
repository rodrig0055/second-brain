"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { scheduledTasks } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

const schema = z.object({
  templateId: z.string().uuid(),
  brandId: z.string().uuid(),
  frequency: z.enum(["daily", "weekly"]),
  inputs: z.record(z.string(), z.string()),
});

export async function createSchedule(formData: FormData) {
  const admin = await requireAdmin();

  // Each task field is submitted as a separate `input.<name>` value by the
  // form (no JSON for the user to write); collect them back into one object.
  const inputs: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("input.")) {
      inputs[key.slice("input.".length)] = String(value);
    }
  }

  const parsed = schema.safeParse({
    templateId: String(formData.get("templateId") ?? ""),
    brandId: String(formData.get("brandId") ?? ""),
    frequency: String(formData.get("frequency") ?? "daily"),
    inputs,
  });
  if (!parsed.success) {
    throw new Error(`Invalid schedule: ${parsed.error.issues[0]?.message}`);
  }

  await db
    .insert(scheduledTasks)
    .values({ ...parsed.data, createdById: admin.id });
  revalidatePath("/admin/schedules");
  redirect("/admin/schedules");
}

export async function toggleSchedule(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("isActive") === "true";
  if (!id) return;
  await db
    .update(scheduledTasks)
    .set({ isActive: !isActive })
    .where(eq(scheduledTasks.id, id));
  revalidatePath("/admin/schedules");
}

export async function deleteSchedule(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(scheduledTasks).where(eq(scheduledTasks.id, id));
  revalidatePath("/admin/schedules");
}
