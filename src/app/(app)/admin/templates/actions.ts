"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { taskTemplates } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { isValidModelId } from "@/lib/models";

const fieldSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[\w-]+$/, "letters, numbers, _ and - only"),
  label: z.string().min(1),
  type: z.enum(["text", "textarea", "select", "date", "number"]),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
});

const templateSchema = z.object({
  teamId: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(300),
  promptTemplate: z.string().min(1),
  model: z.string().min(1),
  // 20, not 12: the Custom Song lyrics task is seeded with 13 fields, so a cap
  // of 12 made that template unsaveable from this editor.
  inputFields: z.array(fieldSchema).max(20),
  isActive: z.boolean(),
  reviewGate: z.boolean(),
});

export async function saveTemplate(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");

  const parsed = templateSchema.safeParse({
    teamId: String(formData.get("teamId") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    promptTemplate: String(formData.get("promptTemplate") ?? ""),
    model: String(formData.get("model") ?? ""),
    inputFields: JSON.parse(String(formData.get("inputFieldsJson") ?? "[]")),
    isActive: formData.get("isActive") === "on",
    reviewGate: formData.get("reviewGate") === "on",
  });
  if (!parsed.success) {
    throw new Error(`Invalid template: ${parsed.error.issues[0]?.message}`);
  }
  if (!(await isValidModelId(parsed.data.model))) {
    throw new Error(`Invalid template: unknown model "${parsed.data.model}"`);
  }

  if (id) {
    await db
      .update(taskTemplates)
      .set(parsed.data)
      .where(eq(taskTemplates.id, id));
  } else {
    await db
      .insert(taskTemplates)
      .values({ ...parsed.data, createdById: admin.id });
  }

  revalidatePath("/admin/templates");
  redirect("/admin/templates");
}

export async function deleteTemplate(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(taskTemplates).where(eq(taskTemplates.id, id));
  revalidatePath("/admin/templates");
  redirect("/admin/templates");
}
