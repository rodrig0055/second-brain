/**
 * The URL inventory the validator checks links against.
 *
 * Storefront pages sit behind Cloudflare and return 403 to anything outside the
 * office network, so a valid URL and a dead one are indistinguishable over HTTP.
 * Validation has to come from data instead.
 *
 * All of it is already in Neon, refreshed weekly by /api/cron/storefront:
 *   products      -> the live product feed (fetched, for current stock/price)
 *   everything    -> `sitemapUrls`, which keeps the latest known state of every
 *                    storefront URL with its type and an `isPresent` flag
 *
 * That matters because the MySQL replica is unreachable from Vercel. Nothing
 * here needs it.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { sitemapUrls } from "@/db/schema";
import type { Inventory } from "./validate";
import { loadCatalog } from "./catalog";

/** Path of a storefront URL, leading and trailing slashes stripped. */
function pathOf(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return "";
  }
}

/**
 * Build the inventory for one brand.
 *
 * A sitemap that has never been captured yields empty collection and search
 * sets. That is reported rather than silently passing every link: an empty
 * inventory would make the validator agree with anything.
 */
export async function loadInventory(
  brandId: string,
  domain: string,
): Promise<{ inventory: Inventory; sitemapSeen: number }> {
  const rows = await db
    .select({ url: sitemapUrls.url, urlType: sitemapUrls.urlType })
    .from(sitemapUrls)
    .where(and(eq(sitemapUrls.brandId, brandId), eq(sitemapUrls.isPresent, true)));

  const collections = new Set<string>();
  const searchPaths = new Set<string>();
  for (const r of rows) {
    const path = pathOf(r.url);
    if (!path) continue;
    const [kind, ...rest] = path.split("/");
    const tail = rest.join("/");
    if (kind === "collection" && tail) collections.add(tail);
    else if (kind === "search" && tail) searchPaths.add(tail);
  }

  // Products come from the live feed rather than the snapshot: a newsletter
  // features specific items, and a stale "in stock" is exactly the error this
  // is here to catch.
  const feed = await loadCatalog(domain);
  const products = new Set(
    feed.map((p) => pathOf(p.link).replace(/^product\//, "")),
  );

  return {
    inventory: { products, collections, searchPaths },
    sitemapSeen: rows.length,
  };
}
