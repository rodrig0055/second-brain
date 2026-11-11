"use server";

import { putObject } from "@/lib/storage";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brandAssets } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

export async function addAsset(formData: FormData) {
  const admin = await requireAdmin();
  const brandId = String(formData.get("brandId") ?? "");
  const label = String(formData.get("label") ?? "").trim();
  const file = formData.get("file");
  if (!brandId || !(file instanceof File) || file.size === 0) return;

  const blob = await putObject(
    `brand-assets/${crypto.randomUUID()}-${file.name}`,
    file,
  );

  await db.insert(brandAssets).values({
    brandId,
    url: blob.url,
    label,
    createdById: admin.id,
  });
  revalidatePath("/admin/assets");
}

export async function deleteAsset(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(brandAssets).where(eq(brandAssets.id, id));
  revalidatePath("/admin/assets");
}
