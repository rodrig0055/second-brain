import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { accessErrorResponse } from "@/lib/access";
import { apiAdsBrand } from "@/lib/ads/access";
import {
  META_PREVIEW_FORMATS,
  fetchAdPreview,
  resolveMetaTarget,
  type MetaPreviewFormat,
} from "@/lib/integrations/meta/client";
import type { DbConnection } from "@/lib/integrations/types";

/**
 * Meta's own rendering of an ad, fetched on demand.
 *
 * On demand rather than synced because a preview URL is short-lived and is only
 * ever wanted for the one ad someone is looking at. Fetching 180 of them nightly
 * to store links that expire would be work done to produce stale data.
 *
 * The response carries a URL, never HTML: Meta returns an iframe snippet, and
 * the src is validated to be https on facebook.com before it leaves the server,
 * so the page never renders markup Meta handed us.
 */
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      team?: string;
      brandId?: string;
      adId?: string;
      format?: string;
    };
    const teamSlug = String(body.team ?? "");
    const brandId = String(body.brandId ?? "");
    const adId = String(body.adId ?? "");

    await apiAdsBrand(teamSlug, brandId);

    // Meta ad ids are long digit strings. Validating the shape keeps an
    // arbitrary path from being appended to a Graph API request.
    if (!/^\d{5,25}$/.test(adId)) {
      return Response.json({ error: "Not an ad id." }, { status: 400 });
    }

    const format = (META_PREVIEW_FORMATS as readonly string[]).includes(
      String(body.format),
    )
      ? (body.format as MetaPreviewFormat)
      : "MOBILE_FEED_STANDARD";

    const connection = await db.query.integrationConnections.findFirst({
      where: and(
        eq(integrationConnections.brandId, brandId),
        eq(integrationConnections.platform, "meta"),
      ),
    });
    if (!connection) {
      return Response.json({ error: "No Meta connection." }, { status: 404 });
    }

    const target = resolveMetaTarget(connection as DbConnection);
    const url = await fetchAdPreview(target, adId, format);

    if (!url) {
      return Response.json(
        {
          error:
            "Meta has no preview for this placement. Try a different one, or " +
            "the ad may no longer exist.",
        },
        { status: 404 },
      );
    }

    return Response.json({ url, format });
  } catch (err) {
    const denied = accessErrorResponse(err);
    if (denied) return denied;
    return Response.json(
      { error: err instanceof Error ? err.message : "Preview failed." },
      { status: 500 },
    );
  }
}
