import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  feedProductChanges,
  sitemapUrlChanges,
  storefrontSnapshots,
} from "@/db/schema";
import { accessErrorResponse, apiBrand } from "@/lib/access";

// Read-only storefront HISTORY for a brand (snapshots + recent deltas). The
// "current" catalog is fetched live via /api/storefront/live instead.
export async function POST(req: Request) {
  try {
    const { brandId, days = 30 } = (await req.json()) as {
      brandId?: string;
      days?: number;
    };
    if (!brandId) {
      return Response.json({ error: "Missing brandId" }, { status: 400 });
    }
    const { brand } = await apiBrand(brandId);
    const lookback = Math.min(Math.max(Number(days) || 30, 1), 180);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - lookback);

    const snapshots = await db
      .select({
        id: storefrontSnapshots.id,
        source: storefrontSnapshots.source,
        countryCode: storefrontSnapshots.countryCode,
        status: storefrontSnapshots.status,
        totalItems: storefrontSnapshots.totalItems,
        addedCount: storefrontSnapshots.addedCount,
        removedCount: storefrontSnapshots.removedCount,
        changedCount: storefrontSnapshots.changedCount,
        summary: storefrontSnapshots.summary,
        errorMessage: storefrontSnapshots.errorMessage,
        capturedAt: storefrontSnapshots.capturedAt,
      })
      .from(storefrontSnapshots)
      .where(eq(storefrontSnapshots.brandId, brandId))
      .orderBy(desc(storefrontSnapshots.capturedAt))
      .limit(60);

    const feedChanges = await db
      .select({
        productId: feedProductChanges.productId,
        title: feedProductChanges.title,
        changeKind: feedProductChanges.changeKind,
        field: feedProductChanges.field,
        oldValue: feedProductChanges.oldValue,
        newValue: feedProductChanges.newValue,
        detectedAt: feedProductChanges.detectedAt,
      })
      .from(feedProductChanges)
      .where(
        and(
          eq(feedProductChanges.brandId, brandId),
          gte(feedProductChanges.detectedAt, since),
        ),
      )
      .orderBy(desc(feedProductChanges.detectedAt))
      .limit(150);

    const sitemapChanges = await db
      .select({
        url: sitemapUrlChanges.url,
        urlType: sitemapUrlChanges.urlType,
        changeKind: sitemapUrlChanges.changeKind,
        detectedAt: sitemapUrlChanges.detectedAt,
      })
      .from(sitemapUrlChanges)
      .where(
        and(
          eq(sitemapUrlChanges.brandId, brandId),
          gte(sitemapUrlChanges.detectedAt, since),
        ),
      )
      .orderBy(desc(sitemapUrlChanges.detectedAt))
      .limit(150);

    return Response.json({
      data: {
        brand: { id: brand.id, name: brand.name, domain: brand.domain },
        snapshots,
        feedChanges,
        sitemapChanges,
      },
    });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("storefront dashboard route error", err);
    return Response.json({ error: "Failed to load" }, { status: 500 });
  }
}
