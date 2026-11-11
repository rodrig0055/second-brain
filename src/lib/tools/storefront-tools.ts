import { tool } from "ai";
import { z } from "zod";
import { and, desc, eq, gte, ilike, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  feedProductChanges,
  feedProducts,
  sitemapUrlChanges,
  storefrontSnapshots,
} from "@/db/schema";
import type { ToolBrand } from "@/lib/integrations/types";

function sinceDate(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/**
 * Brand-scoped tools over the storefront history tables (product feed +
 * sitemap). The current catalog is upserted weekly; the *changes were fetched
 * live and diffed, so these answer "what do we sell / what changed over time".
 */
export function storefrontTools(brand: ToolBrand) {
  return {
    storefrontProducts: tool({
      description:
        "List this brand's current storefront catalog products (from the latest product-feed snapshot), including price, sale price and availability. Use for 'what products do we have', pricing, or stock questions. Filter by a title search term, availability, or on-sale only.",
      inputSchema: z.object({
        search: z
          .string()
          .optional()
          .describe("Case-insensitive substring to match in the product title."),
        availability: z
          .enum(["in stock", "out of stock", "any"])
          .default("any"),
        onSaleOnly: z
          .boolean()
          .default(false)
          .describe("Only products that currently have a sale price."),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: async ({ search, availability, onSaleOnly, limit }) => {
        try {
          const conds = [
            eq(feedProducts.brandId, brand.id),
            eq(feedProducts.isPresent, true),
          ];
          if (search) conds.push(ilike(feedProducts.title, `%${search}%`));
          if (availability !== "any")
            conds.push(eq(feedProducts.availability, availability));
          if (onSaleOnly) conds.push(ne(feedProducts.salePrice, ""));
          const rows = await db
            .select({
              productId: feedProducts.productId,
              title: feedProducts.title,
              link: feedProducts.link,
              price: feedProducts.price,
              salePrice: feedProducts.salePrice,
              availability: feedProducts.availability,
              productType: feedProducts.productType,
            })
            .from(feedProducts)
            .where(and(...conds))
            .orderBy(feedProducts.title)
            .limit(limit);
          return { brand: brand.name, count: rows.length, products: rows };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    storefrontChanges: tool({
      description:
        "Product-feed changes over time for this brand: price changes, sale-price changes, availability flips (stock-ins / stock-outs), and products added or removed. Use for 'what changed since last week', 'which products dropped price', or 'what went out of stock'.",
      inputSchema: z.object({
        days: z
          .number()
          .int()
          .min(1)
          .max(180)
          .default(14)
          .describe("Look back this many days."),
        kind: z
          .enum(["any", "added", "removed", "updated"])
          .default("any"),
        field: z
          .enum(["any", "price", "salePrice", "availability", "title"])
          .default("any")
          .describe("For updates, restrict to one changed field."),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: async ({ days, kind, field, limit }) => {
        try {
          const conds = [
            eq(feedProductChanges.brandId, brand.id),
            gte(feedProductChanges.detectedAt, sinceDate(days)),
          ];
          if (kind !== "any")
            conds.push(eq(feedProductChanges.changeKind, kind));
          if (field !== "any")
            conds.push(eq(feedProductChanges.field, field));
          const rows = await db
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
            .where(and(...conds))
            .orderBy(desc(feedProductChanges.detectedAt))
            .limit(limit);
          return { brand: brand.name, count: rows.length, changes: rows };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    storefrontSitemapChanges: tool({
      description:
        "Sitemap URL changes over time for this brand: pages/products/collections/blog posts added to or removed from the site. Use for 'what new pages went live', 'which URLs were removed', or tracking content/SEO inventory over time.",
      inputSchema: z.object({
        days: z.number().int().min(1).max(180).default(14),
        kind: z.enum(["any", "added", "removed"]).default("any"),
        urlType: z
          .enum([
            "any",
            "product",
            "collection",
            "blog",
            "page",
            "search",
            "other",
          ])
          .default("any"),
        limit: z.number().int().min(1).max(200).default(50),
      }),
      execute: async ({ days, kind, urlType, limit }) => {
        try {
          const conds = [
            eq(sitemapUrlChanges.brandId, brand.id),
            gte(sitemapUrlChanges.detectedAt, sinceDate(days)),
          ];
          if (kind !== "any")
            conds.push(eq(sitemapUrlChanges.changeKind, kind));
          if (urlType !== "any")
            conds.push(eq(sitemapUrlChanges.urlType, urlType));
          const rows = await db
            .select({
              url: sitemapUrlChanges.url,
              urlType: sitemapUrlChanges.urlType,
              changeKind: sitemapUrlChanges.changeKind,
              detectedAt: sitemapUrlChanges.detectedAt,
            })
            .from(sitemapUrlChanges)
            .where(and(...conds))
            .orderBy(desc(sitemapUrlChanges.detectedAt))
            .limit(limit);
          return { brand: brand.name, count: rows.length, changes: rows };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    storefrontSummary: tool({
      description:
        "Latest storefront snapshot summary for this brand — total products / sitemap URLs, counts by page type, in-stock vs out-of-stock, and when each source was last captured. Use for a quick catalog/site overview. A snapshot with status 'error' means the brain's own weekly snapshot job could not read that source; it is NOT evidence the sitemap or feed is broken. Confirm with checkUrls before reporting anything as broken.",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const rows = await db
            .select({
              source: storefrontSnapshots.source,
              countryCode: storefrontSnapshots.countryCode,
              status: storefrontSnapshots.status,
              totalItems: storefrontSnapshots.totalItems,
              addedCount: storefrontSnapshots.addedCount,
              removedCount: storefrontSnapshots.removedCount,
              changedCount: storefrontSnapshots.changedCount,
              summary: storefrontSnapshots.summary,
              capturedAt: storefrontSnapshots.capturedAt,
              errorMessage: storefrontSnapshots.errorMessage,
            })
            .from(storefrontSnapshots)
            .where(eq(storefrontSnapshots.brandId, brand.id))
            .orderBy(desc(storefrontSnapshots.capturedAt))
            .limit(20);
          // Keep the most recent snapshot per source.
          const latest: Record<string, (typeof rows)[number]> = {};
          for (const r of rows) if (!latest[r.source]) latest[r.source] = r;
          return { brand: brand.name, snapshots: Object.values(latest) };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
