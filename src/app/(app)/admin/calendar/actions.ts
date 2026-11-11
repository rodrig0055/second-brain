"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { calendarEvents } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

export async function saveEvent(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const brandIds = formData.getAll("brandIds").map(String).filter(Boolean);
  const name = String(formData.get("name") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const recurring = formData.get("recurring") === "on";
  const isActive = formData.get("isActive") === "on";

  // date is an <input type="date"> value: YYYY-MM-DD.
  if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const values = {
    brandIds, // empty = all brands
    name,
    date,
    recurring,
    notes,
    isActive,
    createdById: admin.id,
  };

  if (id) {
    await db.update(calendarEvents).set(values).where(eq(calendarEvents.id, id));
  } else {
    await db.insert(calendarEvents).values(values);
  }

  revalidatePath("/admin/calendar");
  redirect("/admin/calendar");
}

export async function deleteEvent(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(calendarEvents).where(eq(calendarEvents.id, id));
  revalidatePath("/admin/calendar");
  redirect("/admin/calendar");
}
