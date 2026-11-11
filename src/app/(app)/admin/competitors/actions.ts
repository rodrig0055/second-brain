"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { competitors } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

export async function saveCompetitor(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const brandIds = formData.getAll("brandIds").map(String).filter(Boolean);
  const name = String(formData.get("name") ?? "").trim();
  const domain = String(formData.get("domain") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const isActive = formData.get("isActive") === "on";

  if (!name) return;

  const values = {
    brandIds, // empty = all brands
    name,
    domain,
    notes,
    isActive,
    createdById: admin.id,
  };

  if (id) {
    await db.update(competitors).set(values).where(eq(competitors.id, id));
  } else {
    await db.insert(competitors).values(values);
  }

  revalidatePath("/admin/competitors");
  redirect("/admin/competitors");
}

export async function deleteCompetitor(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(competitors).where(eq(competitors.id, id));
  revalidatePath("/admin/competitors");
  redirect("/admin/competitors");
}
