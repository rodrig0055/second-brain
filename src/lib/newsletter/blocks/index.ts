/**
 * The block registry.
 *
 * Adding a block is: write the module, add it to `DEFS` below, add its data type
 * to `RegisteredBlock`. Nothing else. The emitter, the link walker, the
 * validator, the editor's inputs, the add menu and the planner's vocabulary all
 * read from here.
 *
 * The list is explicit rather than assembled by side-effect imports so that the
 * bundler cannot tree-shake a block away and so the order of the add menu is
 * something we choose rather than something the filesystem chooses.
 */
import type { AnyBlockDef, BlockCategory, FieldDef, VariantDef, RenderCtx } from "./types";

import { headerDef, occasionNavDef, footerDef, type HeaderBlock, type OccasionNavBlock, type FooterBlock } from "./furniture";
import { heroDef, type HeroBlock } from "./hero";
import { productGridDef, newArrivalsDef, featureDef, type ProductGridBlock, type NewArrivalsBlock, type FeatureBlock } from "./products";
import { categoryDef, occasionPushDef, type CategoryBlock, type OccasionPushBlock } from "./amplify";
import { promoCodeDef, ctaDef, bandDef, uspDef, deadlineDef, type PromoCodeBlock, type CtaBlock, type BandBlock, type UspBlock, type DeadlineBlock } from "./promo";
import { reviewsDef, igTagsDef, type ReviewsBlock, type IgTagsBlock } from "./social-proof";
import { appPromoDef, type AppPromoBlock } from "./app";
import {
  zodiacDef, giftHackDef, educationDef, spinWheelDef, scrambleDef, guideDef,
  type ZodiacBlock, type GiftHackBlock, type EducationBlock, type SpinWheelBlock, type ScrambleBlock, type GuideBlock,
} from "./engagement";

/** Every block kind, in add-menu order within its category. */
const DEFS: AnyBlockDef[] = [
  headerDef, occasionNavDef, footerDef,
  heroDef,
  productGridDef, newArrivalsDef, featureDef,
  categoryDef, occasionPushDef,
  promoCodeDef, deadlineDef, ctaDef, bandDef, uspDef,
  reviewsDef, appPromoDef,
  zodiacDef, giftHackDef, educationDef, spinWheelDef, igTagsDef, scrambleDef, guideDef,
];

/**
 * The stored shape of a block. Widening this union is the one place outside a
 * block's own module that has to change when a block is added.
 */
export type RegisteredBlock =
  | HeaderBlock | OccasionNavBlock | FooterBlock
  | HeroBlock
  | ProductGridBlock | NewArrivalsBlock | FeatureBlock
  | CategoryBlock | OccasionPushBlock
  | PromoCodeBlock | DeadlineBlock | CtaBlock | BandBlock | UspBlock
  | ReviewsBlock | IgTagsBlock
  | AppPromoBlock
  | ZodiacBlock | GiftHackBlock | EducationBlock | SpinWheelBlock | ScrambleBlock | GuideBlock;

const BY_KIND = new Map(DEFS.map((d) => [d.kind, d]));

export function allBlockDefs(): AnyBlockDef[] {
  return DEFS;
}

export function getBlockDef(kind: string): AnyBlockDef | null {
  return BY_KIND.get(kind) ?? null;
}

/** The chosen variant, or the first one. An unknown id falls back rather than blanking the block. */
export function variantOf(def: AnyBlockDef, id: string | undefined): VariantDef<never> {
  return (id ? def.variants.find((v) => v.id === id) : undefined) ?? def.variants[0];
}

/** Render one block's rows. Unknown kinds render nothing rather than throwing. */
export function renderBlock(block: { type: string; variant?: string }, ctx: RenderCtx): string[] {
  const def = getBlockDef(block.type);
  if (!def) return [];
  return variantOf(def, block.variant).render(block as never, ctx);
}

/** Blocks a marketer can insert: everything except the fixed frame. */
export function insertableDefs(): AnyBlockDef[] {
  return DEFS.filter((d) => d.category !== "furniture");
}

export function defsByCategory(): Array<{ category: BlockCategory; label: string; defs: AnyBlockDef[] }> {
  const labels: Record<BlockCategory, string> = {
    furniture: "Frame",
    commercial: "Commercial",
    engagement: "Engagement",
  };
  return (["commercial", "engagement", "furniture"] as BlockCategory[])
    .map((category) => ({ category, label: labels[category], defs: DEFS.filter((d) => d.category === category) }))
    .filter((g) => g.defs.length > 0);
}

/** Furniture cannot be moved or removed. */
export const FIXED_KINDS = new Set(DEFS.filter((d) => d.category === "furniture").map((d) => d.kind));

export function fieldsFor(kind: string): FieldDef[] {
  return getBlockDef(kind)?.fields ?? [];
}

/**
 * Fields the inline preview editor is allowed to write, across every block.
 * This replaces a hand-maintained allowlist that silently dropped edits to any
 * field someone forgot to add to it.
 */
export function inlineEditableFields(): Set<string> {
  const out = new Set<string>();
  for (const d of DEFS) for (const f of d.fields) if (f.inline !== false) out.add(f.name);
  return out;
}

/** Every field name any block declares, for validating a form submission. */
export function allFieldNames(): Set<string> {
  const out = new Set<string>();
  for (const d of DEFS) {
    for (const f of d.fields) out.add(f.name);
    for (const f of d.items?.fields ?? []) out.add(f.name);
  }
  return out;
}

/**
 * The vocabulary handed to the planner. Generated so a newly added block is
 * immediately something the brain can propose, without editing a prompt string.
 */
export function blockVocabulary(): string {
  return defsByCategory()
    .filter((g) => g.category !== "furniture")
    .map((g) => `${g.label}:\n` + g.defs.map((d) => {
      const variants = d.variants.map((v) => v.id).join(" | ");
      return `  - ${d.kind} (${d.label}): ${d.blurb} Variants: ${variants}.`;
    }).join("\n"))
    .join("\n\n");
}

export type { AnyBlockDef, BlockCategory, FieldDef, RenderCtx } from "./types";
export type { LinkUnit, LinkCtx, ItemsDef, EmptyCtx } from "./types";
