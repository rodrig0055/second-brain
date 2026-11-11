import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { accessErrorResponse } from "@/lib/access";
import { apiAdsBrand } from "@/lib/ads/access";
import { loadEntityDaily, type AdsLevel } from "@/lib/ads/store";
import { addDays, daysBetween, isYmd } from "@/lib/date-range";

const MAX_DAYS = 400;

/**
 * One entity's daily series over the table's window, for the drawer's chart.
 *
 * Fetched when the drawer opens rather than with the table: a series per row
 * for two hundred rows is a lot of data for the one row anyone clicks.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const teamSlug = url.searchParams.get("team") ?? "";
    const brandId = url.searchParams.get("brandId") ?? "";
    const level = url.searchParams.get("level") ?? "ad";
    const entityId = url.searchParams.get("entityId") ?? "";
    let start = url.searchParams.get("start") ?? "";
    const end = url.searchParams.get("end") ?? "";

    await apiAdsBrand(teamSlug, brandId);

    if (
      !["campaign", "adset", "ad"].includes(level) ||
      !entityId ||
      !isYmd(start) ||
      !isYmd(end) ||
      start > end
    ) {
      return Response.json({ error: "Bad window or entity." }, { status: 400 });
    }
    // A custom window can be any length; past a year the chart is unreadable
    // anyway, so keep the most recent end of it rather than refuse.
    if (daysBetween(start, end) > MAX_DAYS) start = addDays(end, -(MAX_DAYS - 1));

    const connection = await db.query.integrationConnections.findFirst({
      where: and(
        eq(integrationConnections.brandId, brandId),
        eq(integrationConnections.platform, "meta"),
      ),
    });
    if (!connection) return Response.json({ days: [] });

    const days = await loadEntityDaily({
      connectionId: connection.id,
      brandId,
      level: level as AdsLevel,
      entityId,
      range: { start, end },
    });
    return Response.json({ days });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    return Response.json({ error: "Could not load that series." }, { status: 400 });
  }
}
