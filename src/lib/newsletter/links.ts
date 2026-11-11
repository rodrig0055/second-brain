/**
 * Every outbound link a campaign will contain, in render order.
 *
 * Shared by both emitters and by the validator, so "what does this email link
 * to" has exactly one answer. The order also matches the capture order of the
 * sliced renderer, which is how a rendered slice is paired with its href.
 *
 * Each block kind declares its own links, so a new block is covered here the
 * moment it is registered.
 */
import type { Campaign } from "./campaign";
import type { Catalog } from "./catalog";
import { homeUrl } from "./tokens";
import { getBlockDef } from "./blocks";
import type { LinkUnit, LinkCtx } from "./blocks/types";

export type { LinkUnit };

export function linkUnits(c: Campaign, cat: Catalog, assetBase = ""): LinkUnit[] {
  // Every evergreen link belongs to THIS campaign's storefront.
  const ctx: LinkCtx = { campaign: c, catalog: cat, home: homeUrl(c.domain), assetBase };
  const out: LinkUnit[] = [];
  for (const b of c.blocks) {
    const def = getBlockDef(b.type);
    if (!def?.links) continue;
    out.push(...def.links(b as never, ctx));
  }
  return out;
}

/** Product names named by the campaign, in order, deduped. */
export function productNames(c: Campaign): string[] {
  const seen = new Set<string>();
  for (const b of c.blocks) {
    const def = getBlockDef(b.type);
    for (const n of def?.products?.(b as never) ?? []) if (n) seen.add(n);
  }
  return [...seen];
}

/** Non-product images a campaign references, for validation and derivatives. */
export function blockImages(c: Campaign): string[] {
  const seen = new Set<string>();
  for (const b of c.blocks) {
    const def = getBlockDef(b.type);
    for (const src of def?.images?.(b as never) ?? []) if (src) seen.add(src);
  }
  return [...seen];
}
