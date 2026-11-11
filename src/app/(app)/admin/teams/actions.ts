"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { departments, teams } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

/** kebab-case slug from a free-text name. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function createDepartment(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? name));
  if (!name || !slug) return;
  await db.insert(departments).values({ name, slug }).onConflictDoNothing();
  revalidatePath("/admin/teams");
  revalidatePath("/", "layout");
}

export async function deleteDepartment(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // Block deletion while teams still reference it (FK is onDelete: restrict).
  const team = await db.query.teams.findFirst({
    where: eq(teams.departmentId, id),
  });
  if (team) return;
  await db.delete(departments).where(eq(departments.id, id));
  revalidatePath("/admin/teams");
  revalidatePath("/", "layout");
}

export async function createTeam(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const slug = slugify(String(formData.get("slug") ?? name));
  const departmentId = String(formData.get("departmentId") ?? "");
  if (!name || !slug || !departmentId) return;
  await db
    .insert(teams)
    .values({ name, slug, departmentId })
    .onConflictDoNothing();
  revalidatePath("/admin/teams");
  revalidatePath("/", "layout");
}

export async function deleteTeam(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(teams).where(eq(teams.id, id));
  revalidatePath("/admin/teams");
  revalidatePath("/", "layout");
}
