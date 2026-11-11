/**
 * Fill a template's product grids so a new draft arrives ready to read.
 *
 * Preference order:
 *   1. What actually earns clicks. `summarise` already ranks every destination
 *      a brand's sends have linked to; the product ones, resolved against the
 *      live feed and filtered to in stock, are the best guess available.
 *   2. The feed, in order, when a brand has no click history.
 *
 * Only Bloomly SG has results ingested (71 sends). The other five brands have
 * none, so they take the feed path -- and the caller is told which happened,
 * because filling a Bloomly PH grid from Singapore's winners would be worse than
 * filling it from the feed.
 */
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { newsletterCampaigns } from "@/db/schema";
import { fullRowCount } from "./campaign";
import { loadCatalog, resolveOne } from "./catalog";
import { getBlockDef } from "./blocks";
import { loadResults, sinceDaysAgo, summarise } from "./results";
import type { Block } from "./campaign";

export type FillSource = "clicks" | "feed" | "none" | "unavailable";

export type FilledProducts = {
  names: string[];
  source: FillSource;
  /** Names skipped because a recent send already featured them. */
  skippedRecent: string[];
};

/** Products the brand's last `n` campaigns already featured. */
async function recentlyUsed(brandId: string, n = 3): Promise<Set<string>> {
  const rows = await db
    .select({ blocks: newsletterCampaigns.blocks })
    .from(newsletterCampaigns)
    .where(eq(newsletterCampaigns.brandId, brandId))
    .orderBy(desc(newsletterCampaigns.sendDate))
    .limit(n);

  const seen = new Set<string>();
  for (const r of rows) {
    const blocks = (Array.isArray(r.blocks) ? r.blocks : []) as Block[];
    for (const b of blocks) {
      const def = getBlockDef(b.type);
      for (const name of def?.products?.(b as never) ?? []) {
        if (name) seen.add(name.toLowerCase().trim());
      }
    }
  }
  return seen;
}

/**
 * Pick `want` in-stock product titles for a brand.
 *
 * Returns the catalog's own titles, which is what the block model stores, so a
 * filled grid resolves cleanly without a second lookup.
 */
export async function pickProducts(
  brandId: string,
  domain: string,
  want: number,
): Promise<FilledProducts> {
  // Storefront feeds sit behind Cloudflare and can refuse a request. Auto-fill is
  // a convenience, so it degrades to leaving the grids empty; failing the whole
  // create would cost the marketer the draft as well as the products.
  let inStock: Awaited<ReturnType<typeof loadCatalog>> = [];
  try {
    const feed = await loadCatalog(domain);
    inStock = feed.filter((p) => !p.availability || p.availability === "in stock");
  } catch {
    return { names: [], source: "unavailable", skippedRecent: [] };
  }
  if (inStock.length === 0) return { names: [], source: "none", skippedRecent: [] };

  const avoid = await recentlyUsed(brandId);
  const skippedRecent: string[] = [];
  const picked: string[] = [];
  const taken = new Set<string>();

  const take = (title: string): boolean => {
    const k = title.toLowerCase().trim();
    if (taken.has(k)) return false;
    if (avoid.has(k)) { skippedRecent.push(title); return false; }
    taken.add(k);
    picked.push(title);
    return true;
  };

  // 1. Winners from the last 90 days of click data.
  let source: FillSource = "feed";
  const rows = await loadResults(brandId, sinceDaysAgo(90));
  if (rows.length) {
    const top = summarise(rows).top.filter((t) => t.kind === "product");
    for (const t of top) {
      if (picked.length >= want) break;
      // Labels read "Product: True Love"; the feed is the authority on the title.
      const hit = resolveOne(t.label.replace(/^Product:\s*/i, ""), inStock);
      if (hit) take(hit.title);
    }
    if (picked.length > 0) source = "clicks";
  }

  // 2. Top up from the feed. A grid half-filled from history is still a grid
  //    that has to fill its rows.
  for (const p of inStock) {
    if (picked.length >= want) break;
    take(p.title);
  }

  // Rows must be full: hand back a count that has a valid layout, never one
  // that would leave a lone tile for the validator to reject.
  const keep = fullRowCount(Math.min(picked.length, want));
  return { names: picked.slice(0, keep), source: keep > 0 ? source : "none", skippedRecent };
}

/**
 * Fill every empty product grid in a block list.
 *
 * Blocks that already name products are left alone, so this is safe to run over
 * a template that pinned a specific product.
 */
export async function fillProducts(
  blocks: Block[],
  brandId: string,
  domain: string,
): Promise<{ blocks: Block[]; source: FillSource; skippedRecent: string[] }> {
  const wants: Array<{ index: number; want: number; slots: "grid" | "single" }> = [];

  for (const [index, b] of blocks.entries()) {
    const def = getBlockDef(b.type);
    if (!def?.productSlots) continue;
    const already = (def.products?.(b as never) ?? []).filter(Boolean);
    if (already.length) continue;
    if (def.productSlots === "single") {
      wants.push({ index, want: 1, slots: "single" });
    } else {
      const columns = (b as unknown as { columns?: number }).columns ?? 3;
      wants.push({ index, want: columns === 2 ? 4 : 6, slots: "grid" });
    }
  }

  if (wants.length === 0) return { blocks, source: "none", skippedRecent: [] };

  // One pick covering every grid, so two grids in the same email never show the
  // same bouquet.
  const total = wants.reduce((n, w) => n + w.want, 0);
  const { names, source, skippedRecent } = await pickProducts(brandId, domain, total);

  const out = [...blocks];
  let at = 0;
  for (const w of wants) {
    const slice = names.slice(at, at + w.want);
    at += slice.length;
    if (slice.length === 0) continue;
    if (w.slots === "single") {
      out[w.index] = { ...out[w.index], product: slice[0] } as Block;
    } else {
      const keep = slice.slice(0, fullRowCount(slice.length));
      if (keep.length === 0) continue;
      const columns = keep.length % 3 === 0 ? 3 : 2;
      out[w.index] = { ...out[w.index], products: keep, columns } as Block;
    }
  }

  return { blocks: out, source, skippedRecent };
}
