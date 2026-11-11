import { and, between, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { adCreatives, integrationConnections, integrationRecords } from "@/db/schema";
import { accessErrorResponse, apiBrand, apiUser } from "@/lib/access";
import { createSseStream, SSE_HEADERS } from "@/lib/sse";
import { fetchAdsByIds, resolveMetaTarget } from "@/lib/integrations/meta/client";
import { classifyCreative } from "@/lib/integrations/meta/classify";
import { upsertClassification } from "@/lib/ads/creatives/refresh";

export const maxDuration = 300;

// How many ads to classify per request. Full-video Gemini calls are slow, so we
// keep each request well under the 300s cap and let the client loop until
// `remaining` hits 0. Small concurrency avoids Meta / provider rate spikes.
const BATCH_SIZE = 12;
const CONCURRENCY = 4;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resumable, on-demand creative classifier. Finds the ads that ran in the
 * window (from synced ad_insight rows), skips any already classified, and
 * classifies up to BATCH_SIZE of them — streaming one SSE event per ad and a
 * final `{ remaining }` so the client can call again until done.
 */
export async function POST(req: Request) {
  try {
    await apiUser();
    const body = (await req.json()) as {
      connectionId?: string;
      startDate?: string;
      endDate?: string;
      force?: boolean;
    };

    const connectionId = String(body.connectionId ?? "");
    const startDate = String(body.startDate ?? "");
    const endDate = String(body.endDate ?? "");
    const force = Boolean(body.force);

    if (!connectionId || !ISO_DATE.test(startDate) || !ISO_DATE.test(endDate)) {
      return Response.json(
        { error: "Provide connectionId and a valid startDate/endDate (YYYY-MM-DD)." },
        { status: 400 },
      );
    }

    const conn = await db.query.integrationConnections.findFirst({
      where: eq(integrationConnections.id, connectionId),
    });
    if (!conn || conn.platform !== "meta") {
      return Response.json({ error: "Meta account not found." }, { status: 404 });
    }

    // 403/404 unless the user can access the brand this account belongs to.
    await apiBrand(conn.brandId);

    // Ad ids that ran in the window, from synced ad_insight records. externalId
    // is "<ad_id>:<date_start>", so the ad id is the part before the last colon.
    const insightRows = await db
      .select({ externalId: integrationRecords.externalId })
      .from(integrationRecords)
      .where(
        and(
          eq(integrationRecords.brandId, conn.brandId),
          eq(integrationRecords.platform, "meta"),
          eq(integrationRecords.recordType, "ad_insight"),
          between(integrationRecords.periodStart, startDate, endDate),
        ),
      );
    const allAdIds = [
      ...new Set(
        insightRows
          .map((r) => r.externalId.slice(0, r.externalId.lastIndexOf(":")))
          .filter(Boolean),
      ),
    ];

    // Already-classified ads for this connection (skip unless force).
    const existing = force
      ? []
      : await db
          .select({ adId: adCreatives.adId })
          .from(adCreatives)
          .where(
            and(
              eq(adCreatives.connectionId, conn.id),
              inArray(
                adCreatives.adId,
                allAdIds.length ? allAdIds : ["__none__"],
              ),
            ),
          );
    const done = new Set(existing.map((e) => e.adId));
    const pending = allAdIds.filter((id) => !done.has(id));
    const batch = pending.slice(0, BATCH_SIZE);

    const target = resolveMetaTarget(conn);
    const { stream, send, close } = createSseStream();

    (async () => {
      send({
        type: "start",
        total: allAdIds.length,
        alreadyDone: done.size,
        batch: batch.length,
      });

      if (batch.length === 0) {
        send({ type: "done", classified: 0, remaining: pending.length });
        close();
        return;
      }

      let classified = 0;
      try {
        // Fetch creative details for the batch, then classify with bounded
        // concurrency, upserting each result as it lands.
        const creatives = await fetchAdsByIds(target, batch);
        const byId = new Map(creatives.map((c) => [c.adId, c]));

        for (let i = 0; i < batch.length; i += CONCURRENCY) {
          const slice = batch.slice(i, i + CONCURRENCY);
          await Promise.all(
            slice.map(async (adId) => {
              const creative = byId.get(adId);
              if (!creative) {
                send({ type: "skip", adId, reason: "creative not found" });
                return;
              }
              try {
                const { classification, usedFallback } = await classifyCreative(
                  creative,
                  target,
                  { userId: null, brandId: conn.brandId, teamId: null },
                );
                await upsertClassification(conn, creative, classification);
                classified++;
                send({
                  type: "classified",
                  adId: creative.adId,
                  adName: creative.adName,
                  assetType: classification.assetType,
                  messagingAngle: classification.messagingAngle,
                  hookTactic: classification.hookTactic,
                  funnelStage: classification.funnelStage,
                  usedFallback,
                });
              } catch (e) {
                send({
                  type: "error",
                  adId,
                  message: String((e as Error)?.message ?? e),
                });
              }
            }),
          );
        }
      } catch (e) {
        send({ type: "error", message: String((e as Error)?.message ?? e) });
      }

      send({
        type: "done",
        classified,
        remaining: pending.length - classified,
      });
      close();
    })();

    return new Response(stream, { headers: SSE_HEADERS });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("meta creative classify error", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Classification failed" },
      { status: 500 },
    );
  }
}
