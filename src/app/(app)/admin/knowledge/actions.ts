"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { docKind, knowledgeDocs } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { dedupeSlug, slugify } from "@/lib/slug";

const KINDS = docKind.enumValues;

export async function saveDoc(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const teamId = String(formData.get("teamId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const triggerDescription =
    String(formData.get("triggerDescription") ?? "").trim() || null;
  const isActive = formData.get("isActive") === "on";
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (!title || !content) return;
  if (!KINDS.includes(kind as (typeof KINDS)[number])) return;

  // Slug: use the provided one (or derive from title), then dedupe within the
  // (brandId, teamId) scope. Uniqueness is enforced here rather than by a DB
  // constraint to avoid db:push friction with nullable-column unique indexes.
  const scopeBrandId = brandId || null;
  const scopeTeamId = teamId || null;
  const desiredSlug =
    slugify(String(formData.get("slug") ?? "")) || slugify(title);
  const scopeMatch = and(
    scopeBrandId
      ? eq(knowledgeDocs.brandId, scopeBrandId)
      : isNull(knowledgeDocs.brandId),
    scopeTeamId
      ? eq(knowledgeDocs.teamId, scopeTeamId)
      : isNull(knowledgeDocs.teamId),
  );
  const scopeDocs = await db.query.knowledgeDocs.findMany({
    where: id ? and(scopeMatch, ne(knowledgeDocs.id, id)) : scopeMatch,
    columns: { slug: true },
  });
  const taken = new Set(
    scopeDocs.map((d) => d.slug).filter((s): s is string => Boolean(s)),
  );
  const slug = dedupeSlug(desiredSlug, taken);

  const values = {
    brandId: scopeBrandId,
    teamId: scopeTeamId,
    kind: kind as (typeof KINDS)[number],
    title,
    slug,
    tags,
    content,
    triggerDescription,
    isActive,
    updatedById: admin.id,
    updatedAt: new Date(),
  };

  if (id) {
    await db.update(knowledgeDocs).set(values).where(eq(knowledgeDocs.id, id));
  } else {
    await db.insert(knowledgeDocs).values(values);
  }

  revalidatePath("/admin/knowledge");
  redirect("/admin/knowledge");
}

export async function deleteDoc(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(knowledgeDocs).where(eq(knowledgeDocs.id, id));
  revalidatePath("/admin/knowledge");
  redirect("/admin/knowledge");
}
