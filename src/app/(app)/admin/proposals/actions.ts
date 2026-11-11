"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { proposals } from "@/db/schema";
import { requireAdmin, requireUser } from "@/lib/access";
import { captureLoopFromProposal } from "@/lib/loops/capture";
import { canDecideProposal } from "@/lib/proposals/permissions";

/**
 * Dispose of a proposal.
 *
 * The pass proposes and a person disposes: nothing here is automated, and that
 * is the design rather than a shortcut. A proposal says "the catalog doc is out
 * of date" or "this ad needs a fresh creative"; doing the work is a judgment
 * call with a cost, and a brain that silently acted on its own reading of one
 * week would be the opposite of trustworthy.
 *
 * What accepting buys is a record: the proposal stops surfacing, and the next
 * pass sees it was accepted rather than re-filing it.
 */

async function decide(
  formData: FormData,
  state: "applied" | "dismissed",
): Promise<void> {
  // An admin can dispose of anything; a member can dispose of what came out of
  // their own work. That second half is the point of attributing proposals at
  // all — showing someone an item on their dashboard that they cannot action is
  // worse than not showing it.
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing proposal id");

  const target = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
    columns: { sourceUserId: true },
  });
  if (!target) throw new Error("Proposal not found");
  if (!canDecideProposal(user, target)) {
    throw new Error("Not yours to decide.");
  }
  const admin = user;

  const decision = String(formData.get("decision") ?? "").trim().slice(0, 500);
  // A dismissal without a reason is the one thing that makes the inbox worse
  // over time: the next pass cannot tell a bad idea from a mistimed one, so it
  // proposes the same thing again.
  if (state === "dismissed" && !decision) {
    throw new Error("Say why you are dismissing it, so it does not come back.");
  }

  await db
    .update(proposals)
    .set({
      state,
      decision,
      decidedById: admin.id,
      decidedAt: new Date(),
    })
    .where(eq(proposals.id, id));

  revalidatePath("/admin/proposals");
  revalidatePath("/");
}

export async function acceptProposal(formData: FormData): Promise<void> {
  await decide(formData, "applied");

  // An accepted open-loop proposal is the one kind that becomes machinery rather
  // than a note: it enters the research pipeline as a captured loop for the
  // weekly roll-up to grade. Everything else stays a decision record, because
  // acting on it is a judgment with a cost that belongs to a person.
  const id = String(formData.get("id") ?? "");
  const proposal = await db.query.proposals.findFirst({
    where: eq(proposals.id, id),
    columns: { kind: true },
  });
  if (proposal?.kind === "open-loop") {
    try {
      await captureLoopFromProposal(id);
    } catch (err) {
      // The acceptance already stands; failing to capture must not undo it.
      console.error("captureLoopFromProposal failed", err);
    }
  }
  revalidatePath("/admin/loops");
}

export async function dismissProposal(formData: FormData): Promise<void> {
  await decide(formData, "dismissed");
}

/** Move a decided proposal back to pending, for a decision made by mistake. */
export async function reopenProposal(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing proposal id");
  await db
    .update(proposals)
    .set({ state: "pending", decision: "", decidedById: null, decidedAt: null })
    .where(eq(proposals.id, id));
  revalidatePath("/admin/proposals");
}
