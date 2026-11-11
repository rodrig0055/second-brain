import { apiAdsBrand } from "@/lib/ads/access";
import { accessErrorResponse } from "@/lib/access";
import { loadAnnotation, loadNotes } from "@/lib/ads/annotations";
import { loadEntity } from "@/lib/integrations/meta/entity-sync";
import { fromMinorUnits, type EntityLevel } from "@/lib/integrations/meta/entities";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * What a person has said about one entity, fetched when its drawer opens.
 *
 * Kept off the table's own query: annotations and notes are per row and nobody
 * reads two hundred of them, so loading them with the table would be paying for
 * data almost none of which is looked at.
 *
 * Also carries the entity's configuration from the `ad_entities` mirror, which
 * is the first time the workspace can answer "what is this ad set's budget".
 * The mirror's age travels with it: a budget read from a week-old row is a
 * different claim from one read this morning, and the drawer says which.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const teamSlug = url.searchParams.get("team") ?? "";
    const brandId = url.searchParams.get("brandId") ?? "";
    const level = url.searchParams.get("level") ?? "ad";
    const entityId = url.searchParams.get("entityId") ?? "";

    await apiAdsBrand(teamSlug, brandId);

    const connection = await db.query.integrationConnections.findFirst({
      where: and(
        eq(integrationConnections.brandId, brandId),
        eq(integrationConnections.platform, "meta"),
      ),
    });
    if (!connection) {
      return Response.json({ annotation: null, notes: [], config: null });
    }

    const [annotation, notes, entity] = await Promise.all([
      loadAnnotation(connection.id, level, entityId),
      loadNotes(connection.id, level, entityId),
      loadEntity(connection.id, level as EntityLevel, entityId),
    ]);

    const currency = String(connection.config?.currency ?? "USD");
    const config = entity
      ? {
          status: entity.status,
          effectiveStatus: entity.effectiveStatus,
          objective: entity.objective,
          buyingType: entity.buyingType,
          bidStrategy: entity.bidStrategy,
          billingEvent: entity.billingEvent,
          optimizationGoal: entity.optimizationGoal,
          currency,
          dailyBudget: fromMinorUnits(entity.dailyBudgetMinor, currency),
          lifetimeBudget: fromMinorUnits(entity.lifetimeBudgetMinor, currency),
          budgetRemaining: fromMinorUnits(entity.budgetRemainingMinor, currency),
          bidAmount: fromMinorUnits(entity.bidAmountMinor, currency),
          startTime: entity.startTime?.toISOString() ?? null,
          stopTime: entity.stopTime?.toISOString() ?? null,
          targeting: entity.targeting,
          promotedObject: entity.promotedObject,
          fetchedAt: entity.fetchedAt.toISOString(),
        }
      : null;

    return Response.json({
      annotation,
      config,
      notes: notes.map((n) => ({
        id: n.id,
        body: n.body,
        source: n.source,
        createdAt: n.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    return Response.json({ error: "Could not load that entity." }, { status: 400 });
  }
}
