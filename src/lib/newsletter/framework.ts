/**
 * The content framework: which block to push, per brand, per weekday.
 *
 * The framework lives in `newsletter_slots`, transcribed from the 2026 Content
 * Framework spreadsheet. Its `themes` are the marketer's own words ("Zodiac
 * Push", "Customer IG Tags"), and every one of them names a BLOCK, not an
 * email. A template says where an engagement section goes; the framework says
 * what goes in it.
 *
 * Themes are free text typed into a spreadsheet, so matching is on normalised
 * keywords rather than equality. A theme that matches nothing is REPORTED, not
 * dropped -- that is how we find out the spreadsheet grew a new theme.
 */
import { getBlockDef } from "./blocks";
import type { BlockCategory } from "./blocks/types";

/**
 * Theme to block kind.
 *
 * Each entry is a list of lowercase keyword groups; a theme matches when every
 * keyword in a group appears in it. Longer, more specific rules are listed
 * first because the first match wins: "product/category amplification" has to
 * beat the plainer "product amplification".
 */
const RULES: Array<{ all: string[]; kind: string }> = [
  // Engagement
  { all: ["zodiac"], kind: "zodiac" },
  { all: ["horoscope"], kind: "zodiac" },
  { all: ["ig", "tag"], kind: "igTags" },
  { all: ["instagram"], kind: "igTags" },
  { all: ["ugc"], kind: "igTags" },
  { all: ["gift", "hack"], kind: "giftHack" },
  { all: ["hack"], kind: "giftHack" },
  { all: ["tips"], kind: "giftHack" },
  { all: ["gift", "guide"], kind: "guide" },
  { all: ["did", "you", "know"], kind: "education" },
  { all: ["engagement"], kind: "education" },
  { all: ["education"], kind: "education" },
  { all: ["games"], kind: "scramble" },
  { all: ["game"], kind: "scramble" },
  { all: ["spin"], kind: "spinWheel" },

  // Commercial
  { all: ["occasion"], kind: "occasionPush" },
  { all: ["new", "arrival"], kind: "newArrivals" },
  { all: ["review"], kind: "reviews" },
  { all: ["happiness", "rating"], kind: "reviews" },
  { all: ["testimonial"], kind: "reviews" },
  { all: ["category"], kind: "category" },
  { all: ["experience", "box"], kind: "category" },
  { all: ["collection"], kind: "category" },
  { all: ["app"], kind: "appPromo" },
  { all: ["nationwide"], kind: "usp" },
  { all: ["delivery"], kind: "usp" },
  { all: ["voucher"], kind: "promoCode" },
  { all: ["promo"], kind: "promoCode" },
  // Plainest product rule last, so "product/category" and "product push" that
  // carry a more specific word are claimed above before falling to here.
  { all: ["product"], kind: "productGrid" },
  { all: ["bundle"], kind: "productGrid" },
];

function norm(theme: string): string {
  return theme.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** The block a theme asks for, or null when nothing matches. */
export function blockForTheme(theme: string): string | null {
  const t = ` ${norm(theme)} `;
  for (const r of RULES) {
    if (r.all.every((w) => t.includes(` ${w}`))) return r.kind;
  }
  return null;
}

export type ThemeMatch = {
  theme: string;
  /** Block kind, or null when the theme matched no rule. */
  kind: string | null;
  category: BlockCategory | null;
  label: string | null;
};

/** Resolve a weekday's themes to blocks, keeping the unmatched ones visible. */
export function matchThemes(themes: string[]): ThemeMatch[] {
  return themes.map((theme) => {
    const kind = blockForTheme(theme);
    const def = kind ? getBlockDef(kind) : null;
    return {
      theme,
      kind: def ? kind : null,
      category: def?.category ?? null,
      label: def?.label ?? null,
    };
  });
}

export type FrameworkDay = {
  /** 0 = Sunday, matching Date#getDay. */
  weekday: number;
  themes: string[];
  matches: ThemeMatch[];
  voucher: string;
  /** False when the brand does not send on this weekday. */
  sends: boolean;
};

/** 0 = Sunday, read in UTC so a send date is the same day everywhere. */
export function weekdayOf(sendDate: string): number {
  return new Date(`${sendDate}T00:00:00Z`).getUTCDay();
}

/**
 * A weekday the brand does not send on. Not an error: the caller falls back to
 * the template's own defaults and says the framework was silent.
 */
export function silentDay(weekday: number): FrameworkDay {
  return { weekday, themes: [], matches: [], voucher: "", sends: false };
}

export const WEEKDAY_NAME = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;
