"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, userBrandAccess, userTeamAccess } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

function parseTeamIds(formData: FormData): string[] {
  return formData.getAll("teamIds").map(String);
}

function parseBrandIds(formData: FormData): string[] {
  return formData.getAll("brandIds").map(String);
}

export async function addUser(formData: FormData) {
  await requireAdmin();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const role = formData.get("role") === "admin" ? "admin" : "member";
  const teamIds = parseTeamIds(formData);
  const brandIds = parseBrandIds(formData);
  if (!email || !email.includes("@")) return;

  const [created] = await db
    .insert(users)
    .values({ email, role })
    .onConflictDoNothing()
    .returning();

  if (created && teamIds.length > 0) {
    await db
      .insert(userTeamAccess)
      .values(teamIds.map((teamId) => ({ userId: created.id, teamId })))
      .onConflictDoNothing();
  }
  if (created && brandIds.length > 0) {
    await db
      .insert(userBrandAccess)
      .values(brandIds.map((brandId) => ({ userId: created.id, brandId })))
      .onConflictDoNothing();
  }
  revalidatePath("/admin/users");
}

export async function updateUser(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = formData.get("role") === "admin" ? "admin" : "member";
  const teamIds = parseTeamIds(formData);
  const brandIds = parseBrandIds(formData);
  if (!userId) return;

  // Don't let an admin demote themselves and lock everyone out.
  if (userId !== admin.id) {
    await db.update(users).set({ role }).where(eq(users.id, userId));
  }

  await db.delete(userTeamAccess).where(eq(userTeamAccess.userId, userId));
  if (teamIds.length > 0) {
    await db
      .insert(userTeamAccess)
      .values(teamIds.map((teamId) => ({ userId, teamId })))
      .onConflictDoNothing();
  }

  await db.delete(userBrandAccess).where(eq(userBrandAccess.userId, userId));
  if (brandIds.length > 0) {
    await db
      .insert(userBrandAccess)
      .values(brandIds.map((brandId) => ({ userId, brandId })))
      .onConflictDoNothing();
  }
  revalidatePath("/admin/users");
}

export async function removeUser(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === admin.id) return;
  await db.delete(users).where(eq(users.id, userId));
  revalidatePath("/admin/users");
}
