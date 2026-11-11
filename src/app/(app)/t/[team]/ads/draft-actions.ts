"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { adActions, adDrafts, integrationConnections } from "@/db/schema";
import { adsPath, requireAdsBrand } from "@/lib/ads/access";
import { executeAction } from "@/lib/ads/actions/executor";
import { openKeyFor } from "@/lib/ads/actions/permissions";
import { blocksRelease, lintAdCopy } from "@/lib/ads/drafts/lint";
import { loadAccountClaims, writeGateFor } from "@/lib/ads/actions/executor";
import type { DbConnection } from "@/lib/integrations/types";
import type { AdsFormState } from "./actions";
import { measureImage, isOwnMediaUrl } from "@/lib/social/media";
import { putObject } from "@/lib/storage";

/**
 * Server actions for the ad pipeline.
 *
 * Kept apart from the cockpit's own actions file because these are about ads
 * that do not exist yet, where the ones there are about ads that do.
 */

function cockpitPath(teamSlug: string): string {
  return `/t/${teamSlug}/ads`;
}

async function connectionFor(brandId: string) {
  return db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta"),
    ),
  });
}

/**
 * Create a draft.
 *
 * The one entry point for a new pipeline row, whether the copy was written by
 * hand or came out of the ad brief. The brief suggests; this is still the step
 * where a person accepts what they read, which is why the fields it saves are
 * the edited ones from the form rather than anything the model returned.
 */
export async function createDraft(formData: FormData) {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const { user } = await requireAdsBrand(teamSlug, brandId);

  const connection = await connectionFor(brandId);
  if (!connection) return;

  const eventDate = String(formData.get("eventDate") ?? "").trim();
  const cta = String(formData.get("callToAction") ?? "").trim();
  await db.insert(adDrafts).values({
    connectionId: connection.id,
    brandId,
    concept: String(formData.get("concept") ?? "").trim(),
    purpose: String(formData.get("purpose") ?? "BAU").trim() || "BAU",
    eventDate: eventDate || null,
    funnels: formData.getAll("funnels").map(String).filter(Boolean),
    targetAdSetId: String(formData.get("targetAdSetId") ?? "").trim(),
    headline: String(formData.get("headline") ?? "").trim(),
    primaryText: String(formData.get("primaryText") ?? "").trim(),
    callToAction: cta || "SHOP_NOW",
    linkUrl: String(formData.get("linkUrl") ?? "").trim(),
    trelloUrl: String(formData.get("trelloUrl") ?? "").trim(),
    notes: String(formData.get("notes") ?? "").trim(),
    requestedById: user.id,
  });

  revalidatePath(cockpitPath(teamSlug));

  // Saved from somewhere that is not the cockpit (the ad brief): land the
  // person on the queue they just added to, rather than back on an empty form
  // with no sign anything happened.
  if (String(formData.get("goto") ?? "") === "queue") {
    redirect(`${cockpitPath(teamSlug)}?brand=${brandId}&view=queue`);
  }
}

/**
 * Mark a draft ready to run.
 *
 * Refuses on a copy error or a missing ratio. The button is already disabled in
 * those cases, but the button is not the control: this runs on a POST that can
 * be made without ever rendering the page.
 */
export async function markDraftReady(formData: FormData) {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  await requireAdsBrand(teamSlug, brandId);

  const draft = await db.query.adDrafts.findFirst({
    where: and(eq(adDrafts.id, draftId), eq(adDrafts.brandId, brandId)),
  });
  if (!draft) return;

  const findings = lintAdCopy({
    headline: draft.headline,
    primaryText: draft.primaryText,
    description: draft.description,
    purpose: draft.purpose,
    eventDate: draft.eventDate ?? undefined,
  });
  if (blocksRelease(findings)) return;

  const ratios = new Set(
    ((draft.assets ?? []) as { ratio?: string }[]).map((a) => a.ratio),
  );
  if (!ratios.has("1:1") || !ratios.has("9:16")) return;

  await db
    .update(adDrafts)
    .set({
      status: "ready_to_run",
      review: { findings } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(adDrafts.id, draftId));

  revalidatePath(cockpitPath(teamSlug));
}

/**
 * Queue the upload.
 *
 * Goes through the same approval table as a pause, approved in the same moment
 * by whoever clicked, so every change to the live account has one audit trail
 * rather than two.
 */
export async function requestUpload(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const { user } = await requireAdsBrand(teamSlug, brandId);

  const draft = await db.query.adDrafts.findFirst({
    where: and(eq(adDrafts.id, draftId), eq(adDrafts.brandId, brandId)),
  });
  if (!draft) return { error: "That draft no longer exists." };
  if (draft.status === "uploaded" || draft.status === "uploading") {
    return { error: "This one is already at Meta." };
  }
  if (!draft.targetAdSetId) return { error: "Choose the ad set it goes into." };

  // Readiness is checked here rather than trusted from a status, because the
  // only thing that ever set that status was a button nothing could reach: the
  // pipeline required both asset ratios and nothing in the app could produce
  // one, so no draft could ever become ready.
  const findings = lintAdCopy({
    headline: draft.headline,
    primaryText: draft.primaryText,
    description: draft.description,
    purpose: draft.purpose,
    eventDate: draft.eventDate ?? undefined,
  });
  if (blocksRelease(findings)) {
    const first = findings.find((f) => f.severity === "error");
    return { error: first ? first.message : "The copy has something that blocks release." };
  }
  const ratios = new Set(((draft.assets ?? []) as { ratio?: string }[]).map((a) => a.ratio));
  const missing = ["1:1", "9:16"].filter((r) => !ratios.has(r));
  if (missing.length) return { error: `Attach the ${missing.join(" and ")} asset first.` };

  const connection = await connectionFor(brandId);
  if (!connection) return { error: "No Meta account connected for this brand." };

  // The same two gates the executor applies, asked here so the refusal names
  // the fix instead of the button silently doing nothing.
  const gate = writeGateFor(connection as DbConnection, await loadAccountClaims());
  if (!gate.ok) return { error: gate.reason };

  const [created] = await db
    .insert(adActions)
    .values({
      connectionId: connection.id,
      brandId,
      kind: "create_ad",
      level: "ad",
      entityName: draft.concept || "Untitled ad",
      payload: { draftId: draft.id, adSetId: draft.targetAdSetId },
      reason: `Upload "${draft.concept}" into ad set ${draft.targetAdSetId}, paused.`,
      source: "user",
      proposedById: user.id,
      state: "approved",
      openKey: openKeyFor("approved", "create_ad", draft.id),
      decidedById: user.id,
      decidedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: adActions.id });

  if (!created) return { error: "That draft is already going up." };

  await db
    .update(adDrafts)
    .set({ status: "uploading", updatedAt: new Date() })
    .where(eq(adDrafts.id, draftId));

  const result = await executeAction(created.id);
  if (result.state === "failed") {
    // Back to ready, with the reason kept where the person will look for it.
    await db
      .update(adDrafts)
      .set({
        status: "failed_to_run",
        notes: result.detail || draft.notes,
        updatedAt: new Date(),
      })
      .where(eq(adDrafts.id, draftId));
  }

  revalidatePath(adsPath(teamSlug), "layout");
  return result.state === "done"
    ? { ok: "Created on Meta, paused. Turn it on in Ads Manager when you are ready." }
    : { error: result.detail || "Meta refused it." };
}

/** Archive a draft. Kept, not deleted: the archive is the week's record. */
export async function archiveDraft(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  await requireAdsBrand(teamSlug, brandId);

  await db
    .update(adDrafts)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(adDrafts.id, draftId), eq(adDrafts.brandId, brandId)));

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "Archived." };
}

/**
 * Edit a draft's copy after the model wrote it.
 *
 * The brief produces a starting point; the specialist's own wording is what
 * actually runs. Without this the only options were upload it as written or
 * archive it, which is why nothing ever left the pipeline.
 */
export async function updateDraft(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  await requireAdsBrand(teamSlug, brandId);

  const draft = await db.query.adDrafts.findFirst({
    where: and(eq(adDrafts.id, draftId), eq(adDrafts.brandId, brandId)),
  });
  if (!draft) return { error: "That draft no longer exists." };
  if (draft.status === "uploading" || draft.status === "uploaded") {
    return { error: "This one is already at Meta." };
  }

  const text = (key: string, fallback: string) =>
    formData.get(key) !== null ? String(formData.get(key)).trim() : fallback;

  const headline = text("headline", draft.headline);
  const primaryText = text("primaryText", draft.primaryText);
  const description = text("description", draft.description);
  const purpose = text("purpose", draft.purpose);

  const findings = lintAdCopy({
    headline,
    primaryText,
    description,
    purpose,
    eventDate: draft.eventDate ?? undefined,
  });

  await db
    .update(adDrafts)
    .set({
      concept: text("concept", draft.concept),
      headline,
      primaryText,
      description,
      purpose,
      callToAction: text("callToAction", draft.callToAction),
      linkUrl: text("linkUrl", draft.linkUrl),
      targetAdSetId: text("targetAdSetId", draft.targetAdSetId),
      notes: text("notes", draft.notes),
      review: { findings } as unknown as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .where(eq(adDrafts.id, draftId));

  revalidatePath(adsPath(teamSlug), "layout");
  return {
    ok: blocksRelease(findings)
      ? "Saved. The copy still has something that blocks release."
      : "Saved.",
  };
}

/**
 * Attach an asset to a draft.
 *
 * This is what made the pipeline finishable. `markDraftReady` refuses without
 * both a 1:1 and a 9:16, and nothing in the app could ever produce one, so no
 * draft could reach ready. Images come through the server action; anything
 * larger goes straight to blob storage from the browser and arrives here as a
 * URL we then check belongs to us.
 */
export async function attachDraftAsset(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const ratio = String(formData.get("ratio") ?? "");
  await requireAdsBrand(teamSlug, brandId);

  if (ratio !== "1:1" && ratio !== "9:16") {
    return { error: "An asset is either 1:1 or 9:16." };
  }

  const draft = await db.query.adDrafts.findFirst({
    where: and(eq(adDrafts.id, draftId), eq(adDrafts.brandId, brandId)),
  });
  if (!draft) return { error: "That draft no longer exists." };

  const file = formData.get("file");
  const pastedUrl = String(formData.get("url") ?? "").trim();

  let url = "";
  let width = 0;
  let height = 0;

  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith("image/")) {
      return { error: "Upload an image here; video goes through the direct upload." };
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const size = await measureImage(buf).catch(() => ({ width: 0, height: 0 }));
    width = size.width;
    height = size.height;
    const stored = await putObject(
      `ad-assets/${draft.connectionId}/${draftId}/${ratio.replace(":", "x")}-${crypto.randomUUID()}-${file.name}`,
      buf,
      { contentType: file.type },
    );
    url = stored.url;
  } else if (pastedUrl) {
    // Only our own storage, or something this brand already made here: an
    // arbitrary URL would be uploaded to Meta under our account.
    if (!(await isOwnMediaUrl(pastedUrl, brandId))) {
      return { error: "Pick something from this app, or upload the file." };
    }
    url = pastedUrl;
  } else {
    return { error: "Choose a file or pick an image." };
  }

  // A warning rather than a refusal: 2% covers the odd off-by-one pixel, and
  // someone may genuinely want the crop.
  const expected = ratio === "1:1" ? 1 : 9 / 16;
  const actual = height > 0 ? width / height : 0;
  const mismatch = actual > 0 && Math.abs(actual - expected) > expected * 0.02;

  const assets = ((draft.assets ?? []) as Record<string, unknown>[]).filter(
    (a) => a.ratio !== ratio,
  );
  assets.push({
    ratio,
    url,
    kind: "image",
    source: file instanceof File ? "upload" : "picked",
    width,
    height,
  });

  await db
    .update(adDrafts)
    .set({ assets: assets as never, updatedAt: new Date() })
    .where(eq(adDrafts.id, draftId));

  revalidatePath(adsPath(teamSlug), "layout");
  return {
    ok: mismatch
      ? `Attached, but it is ${actual.toFixed(2)}:1 rather than ${ratio}. Meta will crop it.`
      : "Attached.",
  };
}

export async function removeDraftAsset(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const ratio = String(formData.get("ratio") ?? "");
  await requireAdsBrand(teamSlug, brandId);

  const draft = await db.query.adDrafts.findFirst({
    where: and(eq(adDrafts.id, draftId), eq(adDrafts.brandId, brandId)),
  });
  if (!draft) return { error: "That draft no longer exists." };

  const assets = ((draft.assets ?? []) as Record<string, unknown>[]).filter(
    (a) => a.ratio !== ratio,
  );
  await db
    .update(adDrafts)
    .set({ assets: assets as never, updatedAt: new Date() })
    .where(eq(adDrafts.id, draftId));

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "Removed." };
}

/** Put an archived draft back. */
export async function restoreDraft(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  await requireAdsBrand(teamSlug, brandId);

  await db
    .update(adDrafts)
    .set({ status: "requested", archivedAt: null, updatedAt: new Date() })
    .where(and(eq(adDrafts.id, draftId), eq(adDrafts.brandId, brandId)));

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "Back in drafts." };
}
