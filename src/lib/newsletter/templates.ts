/**
 * Templates: the shape of a whole email.
 *
 * A template is a skeleton, not a subject. It says "header, an engagement
 * section, a product grid of some kind, footer". WHAT goes in the engagement
 * section is not part of the template -- that comes from the content framework,
 * which names a block per brand per weekday.
 *
 * So one template renders differently on Tuesday and Saturday, and differently
 * again for another brand, without being a different template. The earlier
 * version of this file got that wrong: it had eight "templates" named after
 * blocks that already exist ("New arrivals", "App push"), and they arrived
 * empty, which is the opposite of ready to send.
 *
 * Pure by design: no database, no network. `frameworkFor` in store.ts reads the
 * slots; this file only decides what to do with them.
 */
import type { Block } from "./campaign";
import { getBlockDef } from "./blocks";
import type { EmptyCtx } from "./blocks/types";
import type { FrameworkDay, ThemeMatch } from "./framework";
import { homeUrl } from "./tokens";

/**
 * Three kinds of hole a framework theme can fill.
 *
 * "grid" exists separately from "support" because a commercial theme is not
 * automatically a product grid: App Feature Push and Nationwide Push are
 * commercial blocks that carry no products. Letting one of those take the
 * product slot would ship an email with nothing to buy.
 */
export type SlotKind = "engagement" | "grid" | "support";

/**
 * Which hole a block kind fits. Null for furniture.
 *
 * "grid" is decided by whether the block actually holds products, which the
 * registry already records as `productSlots`. Collection and occasion tiles are
 * commercial and they look like a grid, but they carry no products, so they are
 * support. Letting one take the product slot shipped a Tuesday send whose only
 * "grid" was four occasion tiles and nothing to buy, while "New Arrivals" sat
 * in the suggestions.
 */
export function slotKindOf(kind: string): SlotKind | null {
  const def = getBlockDef(kind);
  if (!def || def.category === "furniture") return null;
  if (def.category === "engagement") return "engagement";
  return def.productSlots ? "grid" : "support";
}

export type Slot = {
  slot: SlotKind;
  /** Used when the framework names nothing for this hole. */
  fallback?: string;
  /** An optional slot with no match and no fallback is dropped, not left blank. */
  optional?: boolean;
  /** Merged over the resolved block, so a template can pin a variant. */
  patch?: Record<string, unknown>;
};

type Entry = { fixed: string; patch?: Record<string, unknown> } | Slot;

const isSlot = (e: Entry): e is Slot => "slot" in e;

export type TemplateId = "engagement-led" | "product-led" | "sale" | "occasion";

export type EmailTemplate = {
  id: TemplateId;
  label: string;
  blurb: string;
  useWhen: string;
  /** Default subject and preheader, so a new draft is not nameless. */
  subject: string;
  preheader: string;
  entries: Entry[];
};

const f = (fixed: string, patch?: Record<string, unknown>): Entry => ({ fixed, patch });

export const TEMPLATES: EmailTemplate[] = [
  {
    id: "engagement-led",
    label: "Engagement led",
    blurb: "Header, an engagement section, a product grid, one button.",
    useWhen: "The routine weekday send. The framework decides what the engagement section is.",
    subject: "Something worth sending this week",
    preheader: "Picked for the people you keep meaning to surprise.",
    entries: [
      f("header", { variant: "logo" }),
      f("occasionNav", { variant: "icons" }),
      f("hero", {
        variant: "centered",
        headline: "THIS WEEK'S",
        headlineAccent: "GIFT EDIT",
      }),
      { slot: "engagement" },
      f("band", {
        variant: "rule",
        line1: "Picked for the people",
        line2: "you keep meaning to surprise",
        sub: "Order before the cutoff and it arrives today.",
      }),
      { slot: "grid", fallback: "productGrid", patch: { variant: "grid", columns: 3 } },
      f("cta", { variant: "solid", label: "SHOP THE EDIT" }),
      { slot: "support", optional: true },
      f("footer"),
    ],
  },
  {
    id: "product-led",
    label: "Product led",
    blurb: "Products first, then an engagement section to keep the open earning.",
    useWhen: "The products are the story: new stock, a restock, a category worth pushing.",
    subject: "New in this week",
    preheader: "Fresh arrivals, ready to send today.",
    entries: [
      f("header", { variant: "logo" }),
      f("occasionNav", { variant: "icons" }),
      f("hero", {
        variant: "image-first",
        headline: "JUST LANDED",
        headlineAccent: "AND READY TO SEND",
      }),
      { slot: "grid", fallback: "productGrid", patch: { variant: "grid", columns: 3 } },
      f("cta", { variant: "solid", label: "SEE WHAT IS NEW" }),
      { slot: "engagement" },
      { slot: "support", optional: true },
      f("usp", { variant: "columns" }),
      f("footer"),
    ],
  },
  {
    id: "sale",
    label: "Sale",
    blurb: "Dated hero, one product at a flash price, a code, then the grid.",
    useWhen: "A numbered or dated sale: 9.9, 8.8, Payday, the Birthday Sale. Teaser, day-of and last day are all this template with different copy.",
    subject: "The sale is on today",
    preheader: "One price, one day. Gone at midnight.",
    entries: [
      f("header", { variant: "logo" }),
      f("occasionNav", { variant: "icons" }),
      f("hero", {
        variant: "centered",
        badge: "MEGA SALE",
        dates: "9 TO 11 SEPTEMBER",
        headline: "ONE DAY",
        headlineAccent: "ONE PRICE",
      }),
      f("feature", {
        variant: "price-slab",
        label: "OFFER OF THE DAY",
        endsAt: "Today only, until 11:59pm",
      }),
      f("deadline", { variant: "bar", label: "Offer ends", headline: "Tonight at 11:59pm" }),
      f("promoCode", {
        variant: "ticket",
        headline: "EXTRA OFF EVERYTHING ELSE",
        code: "SAVE15",
        terms: "Minimum spend applies. One use per customer.",
      }),
      { slot: "grid", fallback: "productGrid", patch: { variant: "grid", columns: 3 } },
      f("cta", { variant: "pink", label: "GRAB TODAY'S DEAL" }),
      { slot: "engagement", optional: true },
      f("usp", { variant: "bar" }),
      f("footer"),
    ],
  },
  {
    id: "occasion",
    label: "Occasion",
    blurb: "Leads with the occasion, then the products that suit it.",
    useWhen: "A dated occasion: Teacher's Day, Qixi, Valentine's, Mother's Day. Works for the countdown send and the day-of send.",
    subject: "The day is almost here",
    preheader: "Still time to make it land.",
    entries: [
      f("header", { variant: "logo" }),
      f("occasionNav", { variant: "icons" }),
      f("hero", {
        variant: "centered",
        headline: "THE DAY IS",
        headlineAccent: "ALMOST HERE",
      }),
      f("occasionPush", { variant: "tiles", title: "Shop the occasion" }),
      f("band", {
        variant: "centered",
        line1: "Say it properly",
        sub: "Order before the cutoff and it arrives in time.",
      }),
      { slot: "grid", fallback: "productGrid", patch: { variant: "grid", columns: 2 } },
      f("cta", { variant: "solid", label: "SHOP THE OCCASION" }),
      { slot: "engagement", optional: true },
      f("usp", { variant: "columns" }),
      f("footer"),
    ],
  },
];

export function getTemplate(id: string): EmailTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

export function templateContext(brand: string, domain: string): EmptyCtx {
  return { brand, domain, home: homeUrl(domain) };
}

/** Build one block from its registered default, then apply the patch. */
function build(kind: string, ctx: EmptyCtx, patch?: Record<string, unknown>): Block | null {
  const def = getBlockDef(kind);
  if (!def) return null;
  return { ...(def.empty(ctx) as object), ...(patch ?? {}) } as Block;
}

export type Resolved = {
  blocks: Block[];
  /** Framework themes this campaign used, in the order they were placed. */
  used: ThemeMatch[];
  /** Matched themes with no hole left. Offered in the editor as one-click adds. */
  suggested: ThemeMatch[];
  /** Themes that matched no block. A spreadsheet that grew a new theme. */
  unmapped: string[];
  /** False when the brand does not send on this weekday. */
  followedFramework: boolean;
};

/**
 * Turn a template plus a weekday's framework into a concrete block list.
 *
 * Fixed blocks consume a matching theme so a template that already contains, say,
 * an occasion section does not get a second one dropped into its slot.
 */
export function resolveTemplate(
  id: string,
  brand: string,
  domain: string,
  fw: FrameworkDay,
): Resolved | null {
  const t = getTemplate(id);
  if (!t) return null;
  const ctx = templateContext(brand, domain);

  const pool = fw.matches.filter((m) => m.kind);
  const taken = new Set<ThemeMatch>();
  const used: ThemeMatch[] = [];

  const claim = (pred: (m: ThemeMatch) => boolean): ThemeMatch | null => {
    const hit = pool.find((m) => !taken.has(m) && pred(m));
    if (hit) taken.add(hit);
    return hit ?? null;
  };

  // Pass 1: every block the template already contains claims its theme, before
  // any slot gets to look. Without this, a slot earlier in the list takes a
  // theme the template satisfies further down and the block is placed twice --
  // "Nationwide Push" filled the support slot of a template that already ends
  // in a delivery-promise strip.
  const fixedKinds = new Set(t.entries.filter((e) => !isSlot(e)).map((e) => (e as { fixed: string }).fixed));
  for (const kind of fixedKinds) {
    const hit = claim((m) => m.kind === kind);
    if (hit) used.push(hit);
  }

  // Pass 2: slots take what is left, each only a block of its own kind.
  const blocks: Block[] = [];
  for (const e of t.entries) {
    if (!isSlot(e)) {
      const b = build(e.fixed, ctx, e.patch);
      if (b) blocks.push(b);
      continue;
    }

    const hit = claim((m) => m.kind !== null && slotKindOf(m.kind) === e.slot);
    const kind = hit?.kind ?? e.fallback;
    if (!kind) continue; // optional slot, framework silent, no fallback
    if (hit) used.push(hit);
    const b = build(kind, ctx, e.patch);
    if (b) blocks.push(b);
  }

  return {
    blocks,
    used,
    suggested: pool.filter((m) => !taken.has(m)),
    unmapped: fw.matches.filter((m) => !m.kind).map((m) => m.theme),
    followedFramework: fw.sends,
  };
}
