"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { logWikiActivity } from "@/lib/wiki/shared";

function refresh() {
  revalidatePath("/admin/wiki/pending");
  revalidatePath("/admin/wiki");
}

async function loadLesson(id: string) {
  const doc = await db.query.knowledgeDocs.findFirst({
    where: eq(knowledgeDocs.id, id),
  });
  if (!doc || doc.kind !== "lesson") return null;
  return doc;
}

/** Approve a pending lesson → it starts injecting into the brand+team prompt. */
export async function approveLesson(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const doc = await loadLesson(id);
  if (!doc || doc.reviewState !== "pending") return;

  await db
    .update(knowledgeDocs)
    .set({ reviewState: "approved", updatedAt: new Date() })
    .where(eq(knowledgeDocs.id, id));
  await logWikiActivity({
    brandId: doc.brandId!,
    teamId: doc.teamId,
    op: "reflection",
    action: "approved",
    docId: id,
    detail: `approved by admin: "${doc.title}"`,
  });
  refresh();
}

/** Reject a pending lesson → deactivated (pruned). The AI never reactivates it. */
export async function rejectLesson(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const doc = await loadLesson(id);
  if (!doc || doc.reviewState !== "pending") return;

  await db
    .update(knowledgeDocs)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(knowledgeDocs.id, id));
  await logWikiActivity({
    brandId: doc.brandId!,
    teamId: doc.teamId,
    op: "reflection",
    action: "deactivated",
    docId: id,
    detail: `rejected by admin: "${doc.title}"`,
  });
  refresh();
}

/**
 * Approve a pending lesson AND retire the approved lesson it replaces: the new
 * one goes live, the old one is marked superseded (inactive, kept for the trail
 * with a pointer to its successor). Never a silent overwrite — the admin chose.
 */
export async function supersedeLesson(formData: FormData) {
  await requireAdmin();
  const newId = String(formData.get("id") ?? "");
  const oldId = String(formData.get("oldId") ?? "");
  const newDoc = await loadLesson(newId);
  const oldDoc = await loadLesson(oldId);
  if (!newDoc || newDoc.reviewState !== "pending") return;
  if (!oldDoc) return;

  await db
    .update(knowledgeDocs)
    .set({ reviewState: "approved", updatedAt: new Date() })
    .where(eq(knowledgeDocs.id, newId));
  await db
    .update(knowledgeDocs)
    .set({
      reviewState: "superseded",
      isActive: false,
      metadata: { ...oldDoc.metadata, supersededBy: newId },
      updatedAt: new Date(),
    })
    .where(eq(knowledgeDocs.id, oldId));

  await logWikiActivity({
    brandId: newDoc.brandId!,
    teamId: newDoc.teamId,
    op: "reflection",
    action: "approved",
    docId: newId,
    detail: `approved, supersedes "${oldDoc.title}"`,
  });
  await logWikiActivity({
    brandId: oldDoc.brandId!,
    teamId: oldDoc.teamId,
    op: "reflection",
    action: "superseded",
    docId: oldId,
    detail: `superseded by "${newDoc.title}"`,
  });
  refresh();
}
