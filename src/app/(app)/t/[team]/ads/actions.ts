"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  adActions,
  adAlerts,
  adNotes,
  integrationConnections,
  userBrandAccess,
  userTeamAccess,
  teams,
} from "@/db/schema";
import { ADS_TEAM_SLUGS, adsPath, requireAdsBrand } from "@/lib/ads/access";
import {
  executeAction,
  loadAccountClaims,
  writeGateFor,
} from "@/lib/ads/actions/executor";
import { runRules } from "@/lib/ads/rules/run";
import { ensureDigest } from "@/lib/ads/digest";
import type { DbConnection } from "@/lib/integrations/types";
import {
  canDecideAdAction,
  openKeyFor,
  validateRejection,
  type Actor,
} from "@/lib/ads/actions/permissions";
import { isFunnel } from "@/lib/ads/funnel";
import { upsertAnnotation } from "@/lib/ads/annotations";

/**
 * Server actions for the cockpit.
 *
 * Every one of these re-checks team AND brand from the submitted values. The
 * form fields are client-supplied, so the page having rendered is not evidence
 * of anything by the time a POST arrives.
 */

/** Build the actor shape the permission check wants. */
async function actorFor(userId: string, role: "admin" | "member"): Promise<Actor> {
  const [brandRows, teamRows] = await Promise.all([
    db
      .select({ brandId: userBrandAccess.brandId })
      .from(userBrandAccess)
      .where(eq(userBrandAccess.userId, userId)),
    db
      .select({ slug: teams.slug })
      .from(userTeamAccess)
      .innerJoin(teams, eq(teams.id, userTeamAccess.teamId))
      .where(eq(userTeamAccess.userId, userId)),
  ]);
  return {
    id: userId,
    role,
    brandIds: brandRows.map((r) => r.brandId),
    teamSlugs: teamRows.map((r) => r.slug),
  };
}

function cockpitPath(teamSlug: string): string {
  return `/t/${teamSlug}/ads`;
}

/** Silence an alert without changing the ad. */
export async function acknowledgeAlert(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const alertId = String(formData.get("alertId") ?? "");
  const { user } = await requireAdsBrand(teamSlug, brandId);

  await db
    .update(adAlerts)
    .set({
      state: "acknowledged",
      acknowledgedById: user.id,
      acknowledgedAt: new Date(),
    })
    .where(and(eq(adAlerts.id, alertId), eq(adAlerts.brandId, brandId)));

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "Acknowledged." };
}

/**
 * Pause or reactivate an ad, now.
 *
 * The specialist owns the channel, so there is no second approver: the action
 * row is created already decided by the person who clicked, and executed. The
 * `pending` state stays for anything a rule or the agent proposes later.
 *
 * Gated twice on purpose. The deployment switch is a blast radius control and
 * the per-account flag is a statement that this particular token can make
 * changes; the executor checks both again at the moment it writes, because a
 * button that is merely hidden is not a control.
 */
export async function setAdStatusNow(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const entityName = String(formData.get("entityName") ?? "");
  const currentStatus = String(formData.get("currentStatus") ?? "");
  const kind = formData.get("kind") === "activate_ad" ? "activate_ad" : "pause_ad";
  const reason = String(formData.get("reason") ?? "").trim();
  const alertId = String(formData.get("alertId") ?? "") || null;

  const { user } = await requireAdsBrand(teamSlug, brandId);
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta"),
    ),
  });
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
      kind,
      level: "ad",
      entityId,
      entityName,
      // The status as we understood it, so the executor can refuse if someone
      // changed it in Ads Manager in between.
      payload: { expectedStatus: currentStatus || (kind === "pause_ad" ? "ACTIVE" : "PAUSED") },
      reason: reason || (kind === "pause_ad" ? "Paused from the workspace" : "Reactivated from the workspace"),
      source: "user",
      alertId,
      proposedById: user.id,
      state: "approved",
      openKey: openKeyFor("approved", kind, entityId),
      decidedById: user.id,
      decidedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: adActions.id });

  if (!created) {
    return { error: "There is already a change queued for this ad." };
  }

  const result = await executeAction(created.id);
  revalidatePath(adsPath(teamSlug), "layout");

  if (result.state === "done") {
    return { ok: kind === "pause_ad" ? "Paused." : "Reactivated." };
  }
  if (result.state === "stale") {
    return { error: "Someone changed this ad in Ads Manager. Reload and look again." };
  }
  if (result.state === "outcome_unknown") {
    // Deliberately not phrased as a failure: it may well have worked, and
    // telling someone it failed invites them to do it again.
    return { error: result.detail };
  }
  return { error: result.detail || "Meta refused the change." };
}

export async function proposePause(formData: FormData) {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const entityId = String(formData.get("entityId") ?? "");
  const entityName = String(formData.get("entityName") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const currentStatus = String(formData.get("currentStatus") ?? "");
  const alertId = String(formData.get("alertId") ?? "") || null;
  const approveNow = formData.get("approveNow") === "1";

  const { user } = await requireAdsBrand(teamSlug, brandId);
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta"),
    ),
  });
  if (!connection) return;

  const state = approveNow ? "approved" : "pending";
  const [created] = await db
    .insert(adActions)
    .values({
      connectionId: connection.id,
      brandId,
      kind: "pause_ad",
      level: "ad",
      entityId,
      entityName,
      // The status held now, so the executor can tell whether anyone changed
      // it between this moment and the change actually being made.
      payload: { expectedStatus: currentStatus || "ACTIVE" },
      reason,
      source: "user",
      alertId,
      proposedById: user.id,
      state,
      openKey: openKeyFor(state, "pause_ad", entityId),
      decidedById: approveNow ? user.id : null,
      decidedAt: approveNow ? new Date() : null,
    })
    // An entity already carrying an open pause keeps the first one rather than
    // collecting a second; the unique index is what makes that true.
    .onConflictDoNothing()
    .returning({ id: adActions.id });

  if (created && approveNow) await executeAction(created.id);
  revalidatePath(cockpitPath(teamSlug));
}

/** Approve a pending action and run it. */
export async function approveAction(formData: FormData) {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  const { user } = await requireAdsBrand(teamSlug, brandId);

  const action = await db.query.adActions.findFirst({
    where: and(eq(adActions.id, actionId), eq(adActions.brandId, brandId)),
  });
  if (!action) return;

  const decision = canDecideAdAction(
    await actorFor(user.id, user.role as "admin" | "member"),
    {
      brandId: action.brandId,
      state: action.state as never,
      proposedById: action.proposedById,
      source: action.source as never,
    },
    ADS_TEAM_SLUGS,
  );
  if (!decision.allowed) return;

  await db
    .update(adActions)
    .set({
      state: "approved",
      decidedById: user.id,
      decidedAt: new Date(),
      openKey: openKeyFor("approved", action.kind, action.entityId),
      updatedAt: new Date(),
    })
    .where(eq(adActions.id, actionId));

  await executeAction(actionId);
  revalidatePath(cockpitPath(teamSlug));
}

/** Reject a pending action. The reason is required and is kept. */
export async function rejectAction(formData: FormData) {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const actionId = String(formData.get("actionId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const { user } = await requireAdsBrand(teamSlug, brandId);

  if (!validateRejection(reason).allowed) return;

  const action = await db.query.adActions.findFirst({
    where: and(eq(adActions.id, actionId), eq(adActions.brandId, brandId)),
  });
  if (!action) return;

  const decision = canDecideAdAction(
    await actorFor(user.id, user.role as "admin" | "member"),
    {
      brandId: action.brandId,
      state: action.state as never,
      proposedById: action.proposedById,
      source: action.source as never,
    },
    ADS_TEAM_SLUGS,
  );
  if (!decision.allowed) return;

  await db
    .update(adActions)
    .set({
      state: "rejected",
      decidedById: user.id,
      decision: reason.trim(),
      decidedAt: new Date(),
      openKey: null,
      updatedAt: new Date(),
    })
    .where(eq(adActions.id, actionId));

  revalidatePath(cockpitPath(teamSlug));
}

/**
 * Set or correct an entity's funnel.
 *
 * The one write that makes every other number trustworthy: until an ad set is
 * mapped, its spend sits outside every funnel total and its ads are judged
 * against a guess.
 */
export type AdsFormState = { error?: string; ok?: string };

/**
 * Record a decision about a campaign, ad set or ad.
 *
 * Only writes the fields the form actually sent. A drawer that shows the funnel
 * picker but not the Trello field must not wipe the Trello link by leaving it
 * out, which is why an absent key means "leave it alone".
 *
 * This is also what makes the AI's guess promotable: accepting a suggestion
 * writes a row here, which is the only place a funnel counts as decided.
 */
export async function saveAnnotation(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const level = String(formData.get("level") ?? "adset") as "campaign" | "adset" | "ad";
  const entityId = String(formData.get("entityId") ?? "");

  const { user } = await requireAdsBrand(teamSlug, brandId);
  if (!entityId) return { error: "Nothing to annotate." };

  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta"),
    ),
  });
  if (!connection) return { error: "No Meta account connected for this brand." };

  const has = (key: string) => formData.get(key) !== null;
  const text = (key: string) => String(formData.get(key) ?? "").trim();
  const funnelRaw = text("funnel");
  const cirRaw = text("cirTargetPct");

  await upsertAnnotation(
    {
      level,
      entityId,
      entityName: has("entityName") ? text("entityName") : undefined,
      funnel: has("funnel") ? (isFunnel(funnelRaw) ? funnelRaw : null) : undefined,
      audienceLabel: has("audienceLabel") ? text("audienceLabel") : undefined,
      purpose: has("purpose") ? text("purpose") : undefined,
      // A checkbox absent from the POST means unchecked, but only when the form
      // said it was there at all.
      isEventAdSet: has("hasEventToggle") ? formData.get("isEventAdSet") === "1" : undefined,
      cirTargetPct: has("cirTargetPct") ? (cirRaw ? Number(cirRaw) : null) : undefined,
      trelloUrl: has("trelloUrl") ? text("trelloUrl") : undefined,
      hookOverride: has("hookOverride") ? text("hookOverride") || null : undefined,
      angleOverride: has("angleOverride") ? text("angleOverride") || null : undefined,
    },
    { connectionId: connection.id, brandId, userId: user.id, source: "user" },
  );

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "Saved." };
}

/** A line of context beside an entity, so a decision is not only in someone's head. */
export async function addNote(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const level = String(formData.get("level") ?? "ad");
  const entityId = String(formData.get("entityId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  const { user } = await requireAdsBrand(teamSlug, brandId);
  if (!body) return { error: "Write something first." };

  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta"),
    ),
  });
  if (!connection) return { error: "No Meta account connected for this brand." };

  await db.insert(adNotes).values({
    connectionId: connection.id,
    brandId,
    level,
    entityId,
    body,
    source: "user",
    authorId: user.id,
  });

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "Noted." };
}

/** Put an acknowledged alert back on the list. */
export async function reopenAlert(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const alertId = String(formData.get("alertId") ?? "");

  await requireAdsBrand(teamSlug, brandId);
  await db
    .update(adAlerts)
    .set({ state: "open", acknowledgedById: null, acknowledgedAt: null })
    .where(and(eq(adAlerts.id, alertId), eq(adAlerts.brandId, brandId)));

  revalidatePath(adsPath(teamSlug), "layout");
  return { ok: "Back on the list." };
}

/**
 * Judge the account now, rather than waiting for tonight.
 *
 * This used to happen on every page load, which meant opening the overview with
 * three accounts in scope kicked off six thirty-day scans before anything
 * rendered. It reads stored rows and files alerts by fingerprint, so running it
 * twice costs nothing and creates no duplicates.
 */
export async function rerunRules(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");

  await requireAdsBrand(teamSlug, brandId);
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta"),
    ),
  });
  if (!connection) return { error: "No Meta account connected for this brand." };

  const currency = String(connection.config?.currency ?? "USD");
  try {
    const result = await runRules(connection as DbConnection, currency);
    revalidatePath(adsPath(teamSlug), "layout");
    if (result.skipped) return { ok: `Nothing judged: ${result.skipped}` };
    return {
      ok: `Judged ${result.evaluated} entities: ${result.opened} new, ${result.updated} still true, ${result.resolved} resolved.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Build today's digest on demand, when the nightly pass has not run yet. */
export async function buildDigestNow(
  _prev: AdsFormState,
  formData: FormData,
): Promise<AdsFormState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");

  await requireAdsBrand(teamSlug, brandId);
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta"),
    ),
  });
  if (!connection) return { error: "No Meta account connected for this brand." };

  try {
    await ensureDigest(connection as DbConnection, String(connection.config?.currency ?? "USD"));
    revalidatePath(adsPath(teamSlug), "layout");
    return { ok: "Built." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
