"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cmsChangeRequests } from "@/db/schema";
import { requireBrand } from "@/lib/access";
import {
  type CmsRequestView,
  applyCmsRequest,
  getCmsRequestView,
  rejectCmsRequest,
} from "@/lib/integrations/cms/requests";

/**
 * The only way a proposed CMS change reaches the storefront. The chat card
 * calls these; every call re-checks the user's access to the change's brand.
 * Anyone with the brand can apply an edit; publishing needs an admin. Rejecting
 * is for the person who asked, or an admin.
 */

type Result =
  | { ok: true; request: CmsRequestView; canApply: boolean; canReject: boolean }
  | { ok: false; error: string };

async function load(id: string) {
  const row = await db.query.cmsChangeRequests.findFirst({
    where: eq(cmsChangeRequests.id, id),
    columns: { brandId: true },
  });
  if (!row) throw new Error("Change not found.");
  const { user } = await requireBrand(row.brandId);
  const request = await getCmsRequestView(id);
  if (!request) throw new Error("Change not found.");
  const admin = user.role === "admin";
  return {
    user,
    request,
    canApply: request.kind === "publish" ? admin : true,
    canReject: admin || request.createdBy === user.id,
  };
}

export async function getCmsChange(id: string): Promise<Result> {
  try {
    const { request, canApply, canReject } = await load(id);
    return { ok: true, request, canApply, canReject };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function applyCmsChange(id: string): Promise<Result> {
  try {
    const { user, canApply } = await load(id);
    if (!canApply) return { ok: false, error: "Only an admin can publish or unpublish." };
    await applyCmsRequest(id, user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return getCmsChange(id);
}

export async function rejectCmsChange(id: string): Promise<Result> {
  try {
    const { user, canReject } = await load(id);
    if (!canReject) return { ok: false, error: "Only the person who asked, or an admin, can reject this." };
    await rejectCmsRequest(id, user.id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return getCmsChange(id);
}
