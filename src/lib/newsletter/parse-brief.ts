/**
 * Turn the brief a marketer already writes into campaign blocks.
 *
 * The input format is the one the team uses today: sections divided by a rule
 * of box-drawing characters, a headline, some product names, a bracketed CTA,
 * and a promo code at the end. Nothing about how they write has to change.
 *
 * The one non-obvious decision: what counts as a product is decided by the
 * catalog, not by punctuation. A line is a product if it resolves to a real
 * storefront item above the match floor. That is far more robust than guessing
 * from formatting, and it means a typo surfaces as "unmatched" in the editor
 * rather than silently becoming a headline.
 */
import { gridColumns, type Block, type Campaign } from "./campaign";
import { resolveOne, type Resolved } from "./catalog";
import type { FeedProduct } from "@/lib/storefront/parse";
import { homeUrl } from "./tokens";

export type ParseNote = { line: string; note: string };

const RULE = /^[\s─-╿_=-]{6,}$/;
const CTA = /^\[\s*(.+?)\s*\]$/;
const CODE = /^use\s+code[:\s]+(\S+)/i;
const VALID = /^(valid|discount)\b/i;
const SCRAMBLE = /^scramble\s+word[:\s]+(\S+)/i;
const DATES = /^\d{1,2}\s*[-–]\s*\d{1,2}\s+\w+|^\d{1,2}\s+\w+\s*[-–]/;
/** "— Zachary Tan": an attribution line following a customer quote. */
const ATTRIB = /^[—–-]\s*(.{2,60})$/;
/** "*SDD Sticker": the designer's cue for the FREE SAME-DAY DELIVERY badge. */
const SDD = /^\*?\s*sdd\b/i;
/** A short line that names the campaign rather than making a promise. */
const BADGE = /\b(sale|deals?|festival|week|day)\b|^\d+\.\d+/i;

function sections(text: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (RULE.test(line)) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    if (line) cur.push(line);
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Strip a leading "NL for 11 Sept, Fri:" style slug line. */
function isSlugLine(line: string): boolean {
  return /^nl\b.*:$/i.test(line) || /^newsletter\b.*:$/i.test(line);
}

export type ParsedBrief = {
  campaign: Omit<Campaign, "brand" | "domain">;
  notes: ParseNote[];
  /** Every line the parser read as a product, with what it matched. */
  matched: Array<{ line: string; product: Resolved }>;
};

export function parseBrief(
  text: string,
  feed: FeedProduct[],
  opts: { date: string; subject?: string; domain: string },
): ParsedBrief {
  const notes: ParseNote[] = [];
  const home = homeUrl(opts.domain);
  const matched: Array<{ line: string; product: Resolved }> = [];
  const blocks: Block[] = [{ type: "header" }, { type: "occasionNav" }];

  const secs = sections(text).map((s) => s.filter((l) => !isSlugLine(l))).filter((s) => s.length);
  let heroDone = false;

  for (const sec of secs) {
    // Partition the section: products are whatever the catalog recognises.
    const products: string[] = [];
    const prose: string[] = [];
    let cta: { label: string } | null = null;
    let code: { code: string; terms: string[] } | null = null;
    let scramble: string | null = null;
    let sdd = false;
    const reviews: Array<{ quote: string; name: string }> = [];
    // Once a section has started listing products, a line that fails to
    // resolve is almost certainly a product the catalog does not know, not a
    // second headline. Folding it into copy would ship a product name as a
    // shout line -- the silent failure this parser exists to prevent.
    let listing = false;
    const unmatched: string[] = [];

    for (const line of sec) {
      if (SDD.test(line)) { sdd = true; continue; }
      // A quote is whatever prose line immediately precedes an attribution.
      const mAttr = line.match(ATTRIB);
      if (mAttr && prose.length) { reviews.push({ quote: prose.pop()!, name: mAttr[1].trim() }); continue; }
      const mCta = line.match(CTA);
      if (mCta) { cta = { label: mCta[1] }; continue; }
      const mCode = line.match(CODE);
      if (mCode) { code = { code: mCode[1], terms: [] }; continue; }
      const mScr = line.match(SCRAMBLE);
      if (mScr) { scramble = mScr[1]; continue; }
      if (code && VALID.test(line)) { code.terms.push(line); continue; }

      const hit = resolveOne(line, feed);
      if (hit) { listing = true; products.push(line); matched.push({ line, product: hit }); continue; }
      if (listing && line.length <= 48) { unmatched.push(line); continue; }
      prose.push(line);
    }
    for (const u of unmatched)
      notes.push({ line: u, note: "not found in the catalog — check the product name or pick a replacement" });

    // The first section carries the campaign key visual.
    if (!heroDone) {
      const dates = prose.find((l) => DATES.test(l)) ?? "";
      const rest = prose.filter((l) => l !== dates);
      // "9.15 Mid-Month Sale" is the badge even when it is the only line; a
      // brief with no headline is common and the editor asks for one.
      const badgeIdx = rest.findIndex((l) => BADGE.test(l) && l.length <= 32);
      const badge = badgeIdx >= 0 ? rest[badgeIdx] : rest.length > 1 ? rest[0] : "";
      const headlineLines = rest.filter((l) => l !== badge);
      blocks.push({
        type: "hero",
        badge: badge.toUpperCase(),
        dates: dates.replace(/\s*[-–]\s*/, "-").toUpperCase(),
        headline: headlineLines[0] ?? "",
        headlineAccent: headlineLines[1] ?? "",
        kicker: sdd ? "FREE SAME-DAY DELIVERY" : undefined,
        image: "hero",
        href: home,
      });
      heroDone = true;
      if (!headlineLines.length) notes.push({ line: badge || (sec[0] ?? ""), note: "the hero has a badge and dates but no headline — add one" });
      continue;
    }

    if (reviews.length) {
      // Quotes are supplied, never generated: a testimonial the model wrote
      // would be a fabricated customer, and nothing downstream could tell.
      blocks.push({ type: "reviews", title: prose[0], items: reviews });
      continue;
    }

    if (scramble) {
      blocks.push({
        type: "scramble",
        title: prose[0] ?? "",
        hint: prose[1] ?? "",
        answer: scramble,
        footer: prose[2] ?? "",
      });
      continue;
    }

    if (code) {
      blocks.push({
        type: "promoCode",
        headline: prose[0] ?? "",
        code: code.code,
        terms: code.terms.join(" | ").toUpperCase(),
      });
      continue;
    }

    const featureNote =
      products.length === 1 && prose.length > 1 && prose[prose.length - 1].length <= 24 ? prose.pop() : undefined;

    // Headline band: first prose line is the shout, a longer second line reads
    // as supporting copy rather than a second shout.
    if (prose.length) {
      const [first, ...rest] = prose;
      blocks.push({
        type: "band",
        line1: first,
        line2: rest.length === 1 && rest[0].length < 34 ? rest[0] : undefined,
        sub: rest.length && !(rest.length === 1 && rest[0].length < 34) ? rest.join(" ") : undefined,
      });
    }

    if (products.length === 1) {
      // A single product is the full-width feature treatment ("Our 6-hour
      // Flash Price"), never a grid of one. A trailing short line like "10 AM"
      // is its note.
      blocks.push({ type: "feature", product: products[0], note: featureNote });
    } else if (products.length) {
      // The brief's count is kept as written; if it cannot fill its rows the
      // validator blocks and the marketer decides what to add or drop.
      const columns = gridColumns(products.length) ?? (products.length > 3 ? 3 : 2);
      blocks.push({ type: "productGrid", columns, products });
    }

    if (cta) blocks.push({ type: "cta", label: cta.label, href: home });
  }

  blocks.push({ type: "footer" });

  for (const b of blocks)
    if (b.type === "cta" && b.href === home)
      notes.push({ line: b.label, note: "CTA needs a destination — the brief does not say where it goes" });
  if (!blocks.some((b) => b.type === "productGrid"))
    notes.push({ line: "", note: "no products recognised — check the names against the catalog" });

  return {
    campaign: {
      date: opts.date,
      subject: opts.subject ?? "",
      preheader: "",
      blocks,
    },
    notes,
    matched,
  };
}
