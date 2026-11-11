"use server";

import { putObject } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { imageTemplateFolders, imageTemplates } from "@/db/schema";
import { requireUser } from "@/lib/access";
import { extractPageImages } from "@/lib/fetch-page";

const MAX_REFERENCES = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Collect newly-added reference URLs from uploaded files + an optional scrape
// URL, up to the remaining slot count.
async function collectReferenceUrls(
  formData: FormData,
  remaining: number,
): Promise<string[]> {
  const urls: string[] = [];

  const files = formData
    .getAll("files")
    .filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files.slice(0, remaining)) {
    const blob = await putObject(
      `image-templates/${crypto.randomUUID()}-${file.name}`,
      file,
    );
    urls.push(blob.url);
  }

  const importUrl = String(formData.get("importUrl") ?? "").trim();
  if (importUrl && urls.length < remaining) {
    try {
      const scraped = await extractPageImages(importUrl);
      urls.push(...scraped.slice(0, remaining - urls.length));
    } catch {
      // Ignore scrape failures; template can still save with uploaded images.
    }
  }

  return urls;
}

// The form's folder choice: an existing folder, a new one typed in ("__new__" + newFolder), or
// none. A typed name that already exists files into that folder instead of failing on the unique.
async function resolveFolderId(formData: FormData): Promise<string | null> {
  const raw = String(formData.get("folderId") ?? "").trim();
  if (raw === "__new__") {
    return ensureFolder(String(formData.get("newFolder") ?? ""));
  }
  return existingFolderId(raw);
}

async function existingFolderId(id: string | null): Promise<string | null> {
  if (!id || !UUID_RE.test(id)) return null;
  const folder = await db.query.imageTemplateFolders.findFirst({
    where: eq(imageTemplateFolders.id, id),
    columns: { id: true },
  });
  return folder?.id ?? null;
}

async function ensureFolder(nameRaw: string): Promise<string | null> {
  const name = nameRaw.trim().slice(0, 60);
  if (!name) return null;
  await db.insert(imageTemplateFolders).values({ name }).onConflictDoNothing();
  const folder = await db.query.imageTemplateFolders.findFirst({
    where: eq(imageTemplateFolders.name, name),
    columns: { id: true },
  });
  return folder?.id ?? null;
}

export async function createTemplate(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const brandIdRaw = String(formData.get("brandId") ?? "").trim();
  const brandId = brandIdRaw || null;
  const folderId = await resolveFolderId(formData);
  if (!name) return;

  // A template needs a prompt or a reference image. Prompt-only templates are valid: they
  // expect the user to attach their own product photo in Image Studio.
  const referenceUrls = await collectReferenceUrls(formData, MAX_REFERENCES);
  if (!prompt && referenceUrls.length === 0) return;

  await db.insert(imageTemplates).values({
    brandId,
    folderId,
    name,
    description,
    prompt,
    referenceUrls,
    createdById: user.id,
  });
  revalidatePath("/images/templates");
  redirect("/images/templates");
}

export async function updateTemplate(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const prompt = String(formData.get("prompt") ?? "").trim();
  const brandIdRaw = String(formData.get("brandId") ?? "").trim();
  const brandId = brandIdRaw || null;
  const folderId = await resolveFolderId(formData);
  if (!id || !name) return;

  // Existing reference images the user chose to keep, plus any newly added ones.
  const keepUrls = formData.getAll("keepUrls").map(String);
  const newUrls = await collectReferenceUrls(
    formData,
    Math.max(0, MAX_REFERENCES - keepUrls.length),
  );
  const referenceUrls = [...keepUrls, ...newUrls];
  if (!prompt && referenceUrls.length === 0) return;

  await db
    .update(imageTemplates)
    .set({ brandId, folderId, name, description, prompt, referenceUrls })
    .where(eq(imageTemplates.id, id));
  revalidatePath("/images/templates");
  redirect("/images/templates");
}

export async function deleteTemplate(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(imageTemplates).where(eq(imageTemplates.id, id));
  revalidatePath("/images/templates");
  redirect("/images/templates");
}

// Folders. Shared and self-serve like templates, so any signed-in user can tidy them.

export async function createFolder(formData: FormData) {
  await requireUser();
  await ensureFolder(String(formData.get("name") ?? ""));
  revalidatePath("/images/templates");
}

export async function renameFolder(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!id || !name) return;
  const clash = await db.query.imageTemplateFolders.findFirst({
    where: eq(imageTemplateFolders.name, name),
    columns: { id: true },
  });
  if (clash && clash.id !== id) return;
  await db
    .update(imageTemplateFolders)
    .set({ name })
    .where(eq(imageTemplateFolders.id, id));
  revalidatePath("/images/templates");
}

// Unfiles the folder's templates (FK is set null), never deletes them.
export async function deleteFolder(formData: FormData) {
  await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(imageTemplateFolders).where(eq(imageTemplateFolders.id, id));
  revalidatePath("/images/templates");
}

export async function moveTemplate(templateId: string, folderId: string | null) {
  await requireUser();
  if (!templateId) return;
  await db
    .update(imageTemplates)
    .set({ folderId: await existingFolderId(folderId) })
    .where(eq(imageTemplates.id, templateId));
  revalidatePath("/images/templates");
}
