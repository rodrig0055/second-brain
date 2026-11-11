import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  brands,
  feedProductChanges,
  feedProducts,
  integrationConnections,
  sitemapUrlChanges,
  sitemapUrls,
  storefrontSnapshots,
} from "@/db/schema";
import { scrapeRawHtml } from "@/lib/fetch-page";
import { parseFeed, parseSitemap } from "./parse";
import { countryCode, feedUrl, sitemapUrl } from "./urls";

export type StorefrontBrand = {
  id: string;
  slug: string;
  name: string;
  domain: string;
};

export type SnapshotResult = {
  brand: string;
  source: "sitemap" | "feed";
  ok: boolean;
  total: number;
  added: number;
  removed: number;
  changed: number;
  error?: string;
};

const CHUNK = 1000;

function chunk<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** The volatile feed fields we track over time. */
const TRACKED: Array<keyof ReturnType<typeof feedFields>> = [
  "price",
  "salePrice",
  "availability",
  "title",
];
function feedFields(p: {
  price: string;
  salePrice: string;
  availability: string;
  title: string;
}) {
  return {
    price: p.price,
    salePrice: p.salePrice,
    availability: p.availability,
    title: p.title,
  };
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

async function snapshotFeed(brand: StorefrontBrand): Promise<SnapshotResult> {
  const url = feedUrl(brand.domain);
  const cc = countryCode(brand.domain);
  const [snap] = await db
    .insert(storefrontSnapshots)
    .values({ brandId: brand.id, source: "feed", countryCode: cc, url })
    .returning({ id: storefrontSnapshots.id });

  const fail = async (error: string): Promise<SnapshotResult> => {
    await db
      .update(storefrontSnapshots)
      .set({ status: "error", errorMessage: error })
      .where(eq(storefrontSnapshots.id, snap.id));
    return {
      brand: brand.slug,
      source: "feed",
      ok: false,
      total: 0,
      added: 0,
      removed: 0,
      changed: 0,
      error,
    };
  };

  const xml = await scrapeRawHtml(url);
  if (!xml) return fail("fetch failed (no XML returned)");

  let products;
  try {
    products = parseFeed(xml);
  } catch (err) {
    return fail(`parse failed: ${err instanceof Error ? err.message : err}`);
  }
  // A successful fetch that yields nothing usually means a block/format change,
  // not a real empty catalog — never let it mark the whole catalog removed.
  if (products.length === 0) return fail("no products parsed");

  const current = await db
    .select({
      productId: feedProducts.productId,
      title: feedProducts.title,
      price: feedProducts.price,
      salePrice: feedProducts.salePrice,
      availability: feedProducts.availability,
      hubId: feedProducts.hubId,
      cityIds: feedProducts.cityIds,
      description: feedProducts.description,
      isPresent: feedProducts.isPresent,
    })
    .from(feedProducts)
    .where(eq(feedProducts.brandId, brand.id));
  const cur = new Map(current.map((r) => [r.productId, r]));
  const isFirst = cur.size === 0;

  const now = new Date();
  const seen = new Set<string>();
  const toInsert: (typeof feedProducts.$inferInsert)[] = [];
  const changes: (typeof feedProductChanges.$inferInsert)[] = [];
  const changedIds = new Set<string>();
  const productById = new Map(products.map((p) => [p.id, p]));
  const placementDrift: typeof products = [];

  for (const p of products) {
    seen.add(p.id);
    const prev = cur.get(p.id);
    if (!prev) {
      toInsert.push({
        brandId: brand.id,
        productId: p.id,
        title: p.title,
        link: p.link,
        imageLink: p.imageLink,
        price: p.price,
        salePrice: p.salePrice,
        availability: p.availability,
        productType: p.productType,
        googleCategory: p.googleCategory,
        hubId: p.hubId ?? "",
        cityIds: p.cityIds ?? "",
        description: p.description ?? "",
      });
      if (!isFirst) {
        changes.push({
          brandId: brand.id,
          snapshotId: snap.id,
          productId: p.id,
          title: p.title,
          changeKind: "added",
        });
      }
      continue;
    }
    const before = feedFields(prev);
    const after = feedFields(p);
    let changedHere = false;
    for (const field of TRACKED) {
      if (before[field] !== after[field]) {
        changedHere = true;
        changes.push({
          brandId: brand.id,
          snapshotId: snap.id,
          productId: p.id,
          title: p.title,
          changeKind: "updated",
          field,
          oldValue: before[field],
          newValue: after[field],
        });
      }
    }
    if (changedHere) changedIds.add(p.id);
    // Placement fields are not tracked as history, only kept current. This also
    // backfills rows saved before the columns existed.
    if (
      !changedHere &&
      (prev.hubId !== (p.hubId ?? "") ||
        prev.cityIds !== (p.cityIds ?? "") ||
        prev.description !== (p.description ?? ""))
    ) {
      placementDrift.push(p);
    }
  }

  // Products previously present but missing from this pull → removed.
  const removedIds: string[] = [];
  for (const [id, row] of cur) {
    if (row.isPresent && !seen.has(id)) {
      removedIds.push(id);
      changes.push({
        brandId: brand.id,
        snapshotId: snap.id,
        productId: id,
        title: row.title,
        changeKind: "removed",
      });
    }
  }

  // Writes: bulk insert new, bump all-seen, apply per-field updates, mark removed.
  for (const c of chunk(toInsert)) {
    if (c.length) await db.insert(feedProducts).values(c);
  }
  for (const c of chunk([...seen])) {
    if (c.length)
      await db
        .update(feedProducts)
        .set({ lastSeenAt: now, isPresent: true, removedAt: null })
        .where(
          and(
            eq(feedProducts.brandId, brand.id),
            inArray(feedProducts.productId, c),
          ),
        );
  }
  for (const id of changedIds) {
    const p = productById.get(id)!;
    await db
      .update(feedProducts)
      .set({
        title: p.title,
        link: p.link,
        imageLink: p.imageLink,
        price: p.price,
        salePrice: p.salePrice,
        availability: p.availability,
        productType: p.productType,
        googleCategory: p.googleCategory,
        hubId: p.hubId ?? "",
        cityIds: p.cityIds ?? "",
        description: p.description ?? "",
        lastSeenAt: now,
      })
      .where(
        and(
          eq(feedProducts.brandId, brand.id),
          eq(feedProducts.productId, id),
        ),
      );
  }
  // One UPDATE ... FROM (VALUES ...) per chunk: a full backfill is ~7k rows,
  // too many for per-row updates inside the daily cron.
  for (const c of chunk(placementDrift, 500)) {
    if (!c.length) continue;
    const values = sql.join(
      c.map((p) => sql`(${p.id}, ${p.hubId ?? ""}, ${p.cityIds ?? ""}, ${p.description ?? ""})`),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE feed_products AS fp
      SET hub_id = v.hub_id, city_ids = v.city_ids, description = v.description
      FROM (VALUES ${values}) AS v(product_id, hub_id, city_ids, description)
      WHERE fp.brand_id = ${brand.id} AND fp.product_id = v.product_id`);
  }
  for (const c of chunk(removedIds)) {
    if (c.length)
      await db
        .update(feedProducts)
        .set({ isPresent: false, removedAt: now })
        .where(
          and(
            eq(feedProducts.brandId, brand.id),
            inArray(feedProducts.productId, c),
          ),
        );
  }
  for (const c of chunk(changes)) {
    if (c.length) await db.insert(feedProductChanges).values(c);
  }

  const inStock = products.filter(
    (p) => p.availability.toLowerCase() === "in stock",
  ).length;
  const onSale = products.filter((p) => p.salePrice.trim() !== "").length;
  const summary = {
    total: products.length,
    inStock,
    outOfStock: products.length - inStock,
    onSale,
  };

  await db
    .update(storefrontSnapshots)
    .set({
      status: "done",
      totalItems: products.length,
      addedCount: toInsert.length,
      removedCount: removedIds.length,
      changedCount: changedIds.size,
      summary,
    })
    .where(eq(storefrontSnapshots.id, snap.id));

  return {
    brand: brand.slug,
    source: "feed",
    ok: true,
    total: products.length,
    added: toInsert.length,
    removed: removedIds.length,
    changed: changedIds.size,
  };
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

async function snapshotSitemap(
  brand: StorefrontBrand,
): Promise<SnapshotResult> {
  const url = sitemapUrl(brand.domain);
  const cc = countryCode(brand.domain);
  const [snap] = await db
    .insert(storefrontSnapshots)
    .values({ brandId: brand.id, source: "sitemap", countryCode: cc, url })
    .returning({ id: storefrontSnapshots.id });

  const fail = async (error: string): Promise<SnapshotResult> => {
    await db
      .update(storefrontSnapshots)
      .set({ status: "error", errorMessage: error })
      .where(eq(storefrontSnapshots.id, snap.id));
    return {
      brand: brand.slug,
      source: "sitemap",
      ok: false,
      total: 0,
      added: 0,
      removed: 0,
      changed: 0,
      error,
    };
  };

  const xml = await scrapeRawHtml(url);
  if (!xml) return fail("fetch failed (no XML returned)");

  let entries;
  try {
    entries = parseSitemap(xml);
  } catch (err) {
    return fail(`parse failed: ${err instanceof Error ? err.message : err}`);
  }
  if (entries.length === 0) return fail("no URLs parsed");

  // De-dupe (a sitemap can list the same loc twice) keeping first type seen.
  const parsed = new Map<string, string>();
  for (const e of entries) if (!parsed.has(e.url)) parsed.set(e.url, e.type);

  const current = await db
    .select({
      url: sitemapUrls.url,
      urlType: sitemapUrls.urlType,
      isPresent: sitemapUrls.isPresent,
    })
    .from(sitemapUrls)
    .where(eq(sitemapUrls.brandId, brand.id));
  const cur = new Map(current.map((r) => [r.url, r]));
  const isFirst = cur.size === 0;

  const now = new Date();
  const toInsert: (typeof sitemapUrls.$inferInsert)[] = [];
  const changes: (typeof sitemapUrlChanges.$inferInsert)[] = [];
  const seen = new Set<string>();

  for (const [u, type] of parsed) {
    seen.add(u);
    if (!cur.has(u)) {
      toInsert.push({ brandId: brand.id, url: u, urlType: type });
      if (!isFirst) {
        changes.push({
          brandId: brand.id,
          snapshotId: snap.id,
          url: u,
          urlType: type,
          changeKind: "added",
        });
      }
    }
  }

  const removed: string[] = [];
  for (const [u, row] of cur) {
    if (row.isPresent && !seen.has(u)) {
      removed.push(u);
      changes.push({
        brandId: brand.id,
        snapshotId: snap.id,
        url: u,
        urlType: row.urlType,
        changeKind: "removed",
      });
    }
  }

  for (const c of chunk(toInsert)) {
    if (c.length) await db.insert(sitemapUrls).values(c);
  }
  for (const c of chunk([...seen])) {
    if (c.length)
      await db
        .update(sitemapUrls)
        .set({ lastSeenAt: now, isPresent: true, removedAt: null })
        .where(
          and(eq(sitemapUrls.brandId, brand.id), inArray(sitemapUrls.url, c)),
        );
  }
  for (const c of chunk(removed)) {
    if (c.length)
      await db
        .update(sitemapUrls)
        .set({ isPresent: false, removedAt: now })
        .where(
          and(eq(sitemapUrls.brandId, brand.id), inArray(sitemapUrls.url, c)),
        );
  }
  for (const c of chunk(changes)) {
    if (c.length) await db.insert(sitemapUrlChanges).values(c);
  }

  const summary: Record<string, number> = { total: parsed.size };
  for (const type of parsed.values())
    summary[type] = (summary[type] ?? 0) + 1;

  await db
    .update(storefrontSnapshots)
    .set({
      status: "done",
      totalItems: parsed.size,
      addedCount: toInsert.length,
      removedCount: removed.length,
      changedCount: 0,
      summary,
    })
    .where(eq(storefrontSnapshots.id, snap.id));

  return {
    brand: brand.slug,
    source: "sitemap",
    ok: true,
    total: parsed.size,
    added: toInsert.length,
    removed: removed.length,
    changed: 0,
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/** Snapshot one brand's sitemap and feed (sequential to bound load on the storefront). */
export async function snapshotBrand(
  brand: StorefrontBrand,
): Promise<SnapshotResult[]> {
  const results: SnapshotResult[] = [];
  for (const run of [snapshotSitemap, snapshotFeed]) {
    try {
      results.push(await run(brand));
    } catch (err) {
      results.push({
        brand: brand.slug,
        source: run === snapshotFeed ? "feed" : "sitemap",
        ok: false,
        total: 0,
        added: 0,
        removed: 0,
        changed: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

/**
 * Storefront brands = every brand that is NOT on Shopify (Northwind Audio). The
 * custom-CMS brands expose the `sitemap<CC>.xml` + `/data/feed/` endpoints;
 * Shopify brands have their own product API and a different sitemap layout.
 */
export async function getStorefrontBrands(): Promise<StorefrontBrand[]> {
  const all = await db
    .select({
      id: brands.id,
      slug: brands.slug,
      name: brands.name,
      domain: brands.domain,
    })
    .from(brands);
  const shopify = await db
    .select({ brandId: integrationConnections.brandId })
    .from(integrationConnections)
    .where(eq(integrationConnections.platform, "shopify"));
  const shopifyIds = new Set(shopify.map((c) => c.brandId));
  return all.filter((b) => !shopifyIds.has(b.id));
}

/** Snapshot all storefront brands. Used by the weekly cron + manual trigger. */
export async function snapshotAllStorefronts(): Promise<{
  results: SnapshotResult[];
  ok: number;
  failed: number;
}> {
  const brandList = await getStorefrontBrands();
  const results: SnapshotResult[] = [];
  for (const brand of brandList) {
    results.push(...(await snapshotBrand(brand)));
  }
  return {
    results,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
  };
}
