/**
 * The block contract.
 *
 * A block kind is declared once, in one file, and everything else reads it from
 * the registry: the HTML emitter, the link walker, the validator, the editor's
 * field inputs, the "add block" menu and the planner's vocabulary. Before this
 * existed a new block had to be added to six separate switch statements, which
 * is why the block list had stopped growing.
 *
 * See ./README.md for how to add one.
 */
import type { Campaign } from "../campaign";
import type { Catalog } from "../catalog";
import type { BrandAssets } from "../tokens";

/** Every stored block carries its kind and, optionally, a chosen design. */
export type BlockBase = { type: string; variant?: string };

/**
 * Where a block is allowed to sit and how it reads to the marketer.
 *
 * "furniture" is the frame (logo, nav, footer): present in every send, never
 * moved, never deleted. The other two are the two halves of the content
 * framework the team already plans against.
 */
export type BlockCategory = "furniture" | "commercial" | "engagement";

export type FieldKind = "text" | "long" | "url" | "code";

export type FieldDef = {
  /** Property name on the block. */
  name: string;
  label: string;
  kind?: FieldKind;
  hint?: string;
  /**
   * Editable straight in the preview iframe. Text that is rendered as a run of
   * copy can be; a URL or a product reference cannot, because clicking it in
   * the preview would navigate instead of focus.
   */
  inline?: boolean;
};

/** A repeated sub-row (a review, a guide row, an IG tag) rendered generically. */
export type ItemsDef = {
  /** The array property on the block. */
  prop: string;
  /** Singular noun, for the editor heading and the add button. */
  label: string;
  fields: FieldDef[];
  /** Rows beyond this are ignored by the renderer. */
  max?: number;
};

/** Everything a variant needs to emit its rows. Built once per render. */
export type RenderCtx = {
  campaign: Campaign;
  catalog: Catalog;
  assets: BrandAssets | null;
  /** The campaign hero image, or "" when art has not been generated yet. */
  heroUrl: string;
  /** Product name to resized image URL. Falls back to the raw feed image. */
  imgs: Map<string, string>;
  /** This campaign's storefront root. Never a hardcoded brand. */
  home: string;
  /** Where /public is served from, for absolute asset URLs inside the email. */
  assetBase: string;
  /** Preview mode: copy is wrapped in editable spans. Never true for SendPulse. */
  editable: boolean;
  /** This block's position, needed to bind inline edits back to it. */
  index: number;
  /** Escaped text, or an editable span bound to `field` when in preview mode. */
  ed(field: string, text: string): string;
  /** Wrap inner HTML in one full-width table row. */
  row(inner: string, bg?: string, pad?: string): string;
  /** Bulletproof button, VML fallback included. */
  button(label: string, href: string, labelHtml?: string): string;
};

export type LinkUnit = {
  href: string;
  alt: string;
  width: number;
  /** Set when the unit belongs to a multi-column row: "nav" | "grid2" | "grid3". */
  row?: string;
};

export type LinkCtx = { campaign: Campaign; catalog: Catalog; home: string; assetBase: string };

/** Context available when spawning a fresh, empty block. */
export type EmptyCtx = { home: string; domain: string; brand: string };

export type VariantDef<D> = {
  id: string;
  label: string;
  /** One line in the picker saying what is different about this design. */
  blurb?: string;
  /** Table rows, in order. A grid returns one row per row of tiles. */
  render(block: D, ctx: RenderCtx): string[];
};

export type BlockDef<D extends BlockBase = BlockBase> = {
  kind: string;
  /** How it reads in the UI: "Product amplification", not "productGrid". */
  label: string;
  category: BlockCategory;
  /** One sentence for the add menu and the planner prompt. */
  blurb: string;
  fields: FieldDef[];
  items?: ItemsDef;
  /** At least one. The first is the default when a block stores no variant. */
  variants: VariantDef<D>[];
  empty(ctx: EmptyCtx): D;
  /** Product names this block references, so the catalog can resolve them. */
  products?(block: D): string[];
  /** Whether this block holds a list of products the editor can edit. */
  productSlots?: "grid" | "single";
  /** Every outbound link, in render order. */
  links?(block: D, ctx: LinkCtx): LinkUnit[];
  /** Absolute image URLs the block references beyond product photos. */
  images?(block: D): string[];
};

/**
 * The registry is heterogeneous by nature, so the one place that erases the
 * per-block data type is here. Each block module stays fully typed internally.
 */
export type AnyBlockDef = BlockDef<never> & {
  variants: Array<{ id: string; label: string; blurb?: string; render(block: never, ctx: RenderCtx): string[] }>;
};

export function defineBlock<D extends BlockBase>(def: BlockDef<D>): AnyBlockDef {
  if (def.variants.length === 0) throw new Error(`block "${def.kind}" declares no variants`);
  return def as unknown as AnyBlockDef;
}
