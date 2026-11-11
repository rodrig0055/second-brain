"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { adChangeSets } from "@/db/schema";
import { adsPath, requireAdsBrand } from "@/lib/ads/access";
import {
  applyChangeSet,
  approveChangeSet,
  rejectChangeSet,
} from "@/lib/ads/actions/change-set";
import { validateRejection } from "@/lib/ads/actions/permissions";

export type ChangeFormState = { error?: string; ok?: string };

/**
 * Approve a set and apply it in the same request.
 *
 * Deliberately one step rather than two. A set that is approved and then
 * waits for a sweep is a set whose author has walked away from a decision
 * they believe is already made, and the staleness checks inside each action
 * are what make the delay safe rather than a second button.
 */
export async function approveAndApply(
  _prev: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const setId = String(formData.get("setId") ?? "");
  const note = String(formData.get("note") ?? "").trim();

  const set = await db.query.adChangeSets.findFirst({
    where: eq(adChangeSets.id, setId),
  });
  if (!set) return { error: "That change set is gone." };

  // Brand is re-read from the row rather than taken from the form: the form is
  // client-supplied and the brand is what authorises the whole thing.
  const { user } = await requireAdsBrand(teamSlug, set.brandId);

  await approveChangeSet(setId, user.id, note);
  const result = await applyChangeSet(setId);
  revalidatePath(`${adsPath(teamSlug)}/changes`, "layout");

  if (result.state === "done") {
    return { ok: `Applied ${result.applied} change(s).` };
  }
  if (result.state === "partial") {
    const parts = [
      `${result.applied} applied`,
      result.failed ? `${result.failed} failed` : "",
      result.stale ? `${result.stale} left alone as stale` : "",
      result.unknown ? `${result.unknown} outcome unknown` : "",
    ].filter(Boolean);
    return { error: `Partly applied: ${parts.join(", ")}. Read each row below.` };
  }
  if (result.state === "approved") {
    // Approved, and then every action was refused before it could start. The
    // executor knows why — writes off, or the account claimed by two brands —
    // and that reason is the only useful thing to say here. Without it the
    // button looks broken rather than blocked.
    const why = result.results.find((r) => r.detail)?.detail;
    return {
      error:
        why ??
        "Approved, but nothing could be applied. Check that writes are on for this account.",
    };
  }
  return { error: `The set is ${result.state}.` };
}

/** Reject a set, with the reason the next pass reads. */
export async function rejectSet(
  _prev: ChangeFormState,
  formData: FormData,
): Promise<ChangeFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const setId = String(formData.get("setId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  const set = await db.query.adChangeSets.findFirst({
    where: eq(adChangeSets.id, setId),
  });
  if (!set) return { error: "That change set is gone." };
  const { user } = await requireAdsBrand(teamSlug, set.brandId);

  const valid = validateRejection(reason);
  if (!valid.allowed) return { error: valid.reason };

  await rejectChangeSet(setId, user.id, reason.trim());
  revalidatePath(`${adsPath(teamSlug)}/changes`, "layout");
  return { ok: "Rejected." };
}
