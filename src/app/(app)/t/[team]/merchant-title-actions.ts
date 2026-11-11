"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { merchantTitleBatches } from "@/db/schema";
import { requireBrand } from "@/lib/access";
import {
  type TitleBatchView,
  applyTitleBatch,
  getTitleBatchView,
  revertTitleBatch,
} from "@/lib/integrations/merchant_center/titles";

/**
 * The only way a title batch reaches Google. The chat card calls these; every
 * call re-checks the user's access to the batch's brand, and apply/revert also
 * require an admin, whatever the card shows.
 */

type Result = { ok: true; batch: TitleBatchView; canApprove: boolean } | { ok: false; error: string };

async function load(batchId: string) {
  const row = await db.query.merchantTitleBatches.findFirst({
    where: eq(merchantTitleBatches.id, batchId),
    columns: { brandId: true },
  });
  if (!row) throw new Error("Batch not found.");
  const { user, brand } = await requireBrand(row.brandId);
  const batch = await getTitleBatchView(batchId, brand.slug);
  if (!batch) throw new Error("Batch not found.");
  return { user, brand, batch };
}

export async function getMerchantTitleBatch(batchId: string): Promise<Result> {
  try {
    const { user, batch } = await load(batchId);
    return { ok: true, batch, canApprove: user.role === "admin" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function approveMerchantTitleBatch(batchId: string): Promise<Result> {
  try {
    const { user } = await load(batchId);
    if (user.role !== "admin") return { ok: false, error: "Only an admin can approve titles." };
    await applyTitleBatch(batchId, user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return getMerchantTitleBatch(batchId);
}

export async function revertMerchantTitleBatch(batchId: string): Promise<Result> {
  try {
    const { user } = await load(batchId);
    if (user.role !== "admin") return { ok: false, error: "Only an admin can revert titles." };
    await revertTitleBatch(batchId, user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return getMerchantTitleBatch(batchId);
}
