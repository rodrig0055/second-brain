import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { adAnnotations, adNotes } from "@/db/schema";

/**
 * What a person has decided about a campaign, ad set or ad.
 *
 * This table is the only place a funnel is a fact. The classifier's guess lives
 * in `ad_creatives.funnelStage` and stays a suggestion until somebody accepts
 * it, which writes a row here with `source` saying who. Keeping those apart is
 * what lets the funnel numbers mean what their column heading says.
 *
 * Shared by the workspace and the chat tool so both write the same shape.
 */

export type AnnotationInput = {
  level: "campaign" | "adset" | "ad";
  entityId: string;
  entityName?: string;
  funnel?: "TOF" | "MOF" | "BOF" | null;
  audienceLabel?: string;
  purpose?: string;
  isEventAdSet?: boolean;
  cirTargetPct?: number | null;
  trelloUrl?: string;
  hookOverride?: string | null;
  angleOverride?: string | null;
};

export type AnnotationContext = {
  connectionId: string;
  brandId: string;
  userId: string;
  source: "user" | "chat" | "seed";
};

/**
 * Write only what the caller actually sent.
 *
 * A form that shows the funnel picker but not the Trello field must not wipe
 * the Trello link by omitting it, so an absent key means "leave it alone"
 * rather than "set it to empty".
 */
export async function upsertAnnotation(
  input: AnnotationInput,
  ctx: AnnotationContext,
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date(), updatedById: ctx.userId, source: ctx.source };
  if (input.entityName !== undefined) set.entityName = input.entityName;
  if (input.funnel !== undefined) set.funnel = input.funnel;
  if (input.audienceLabel !== undefined) set.audienceLabel = input.audienceLabel;
  if (input.purpose !== undefined) set.purpose = input.purpose;
  if (input.isEventAdSet !== undefined) set.isEventAdSet = input.isEventAdSet;
  if (input.cirTargetPct !== undefined) {
    set.cirTargetPct = input.cirTargetPct === null ? null : String(input.cirTargetPct);
  }
  if (input.trelloUrl !== undefined) set.trelloUrl = input.trelloUrl;
  if (input.hookOverride !== undefined) set.hookOverride = input.hookOverride;
  if (input.angleOverride !== undefined) set.angleOverride = input.angleOverride;

  await db
    .insert(adAnnotations)
    .values({
      connectionId: ctx.connectionId,
      brandId: ctx.brandId,
      level: input.level,
      entityId: input.entityId,
      entityName: input.entityName ?? "",
      funnel: input.funnel ?? null,
      audienceLabel: input.audienceLabel ?? "",
      purpose: input.purpose ?? "",
      isEventAdSet: input.isEventAdSet ?? false,
      cirTargetPct:
        input.cirTargetPct === undefined || input.cirTargetPct === null
          ? null
          : String(input.cirTargetPct),
      trelloUrl: input.trelloUrl ?? "",
      hookOverride: input.hookOverride ?? null,
      angleOverride: input.angleOverride ?? null,
      updatedById: ctx.userId,
      source: ctx.source,
    })
    .onConflictDoUpdate({
      target: [adAnnotations.connectionId, adAnnotations.level, adAnnotations.entityId],
      set,
    });
}

export async function loadAnnotation(
  connectionId: string,
  level: string,
  entityId: string,
): Promise<typeof adAnnotations.$inferSelect | null> {
  return (
    (await db.query.adAnnotations.findFirst({
      where: and(
        eq(adAnnotations.connectionId, connectionId),
        eq(adAnnotations.level, level),
        eq(adAnnotations.entityId, entityId),
      ),
    })) ?? null
  );
}

export async function loadNotes(
  connectionId: string,
  level: string,
  entityId: string,
  limit = 20,
): Promise<(typeof adNotes.$inferSelect)[]> {
  return db
    .select()
    .from(adNotes)
    .where(
      and(
        eq(adNotes.connectionId, connectionId),
        eq(adNotes.level, level),
        eq(adNotes.entityId, entityId),
      ),
    )
    .orderBy(desc(adNotes.createdAt))
    .limit(limit);
}
