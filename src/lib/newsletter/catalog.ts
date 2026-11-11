/**
 * Product resolution for generated newsletters.
 *
 * The marketing brief names products the way a person says them ("True Love
 * (99 Red Roses)", "Rosy Sweet Gift Set"). Everything the email needs beyond
 * that name -- the /product/<slug> URL, the photo, the price -- already exists
 * in the storefront feed, so nobody should be typing links by hand.
 *
 * Reuses the app's own feed parser so this stays in step with the weekly
 * snapshot in src/lib/storefront/snapshot.ts.
 */
import { parseFeed, type FeedProduct } from "@/lib/storefront/parse";
import { feedUrl } from "@/lib/storefront/urls";

export type Resolved = FeedProduct & { matchedOn: string; score: number };

/** Brief name -> resolved product. `null` means nothing cleared the floor. */
export type Catalog = Map<string, Resolved | null>;

/** Lowercase, drop punctuation and parenthetical asides, collapse whitespace. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return norm(s).split(" ").filter(Boolean);
}

/** Jaccard overlap on tokens, with a bonus for exact and prefix matches. */
function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = new Set([...ta, ...tb]).size;
  let score = union ? shared / union : 0;
  // "True Love" should beat "True Love Deluxe" for the brief term "True Love".
  if (nb.startsWith(na) || na.startsWith(nb)) score += 0.25;
  return Math.min(score, 0.999);
}

export async function loadCatalog(domain: string): Promise<FeedProduct[]> {
  const url = feedUrl(domain);
  const res = await fetch(url, { headers: { "user-agent": "second-brain-newsletter/1.0" } });
  if (!res.ok) throw new Error(`feed ${url} returned ${res.status}`);
  return parseFeed(await res.text());
}

/**
 * Resolve one brief line to a catalog product. Returns null rather than
 * guessing when nothing clears the floor -- a wrong product link in a live
 * campaign is worse than an obvious gap the reviewer has to fill.
 */
export function resolveOne(name: string, catalog: FeedProduct[], floor = 0.5): Resolved | null {
  let best: Resolved | null = null;
  for (const p of catalog) {
    const score = similarity(name, p.title);
    if (!best || score > best.score) best = { ...p, matchedOn: p.title, score };
  }
  if (!best || best.score < floor) return null;
  return best;
}

/**
 * Resolve what a person typed into a product picker: a storefront URL, a bare
 * slug, or a name. URLs and slugs match exactly on the feed's link; anything
 * else goes through the fuzzy name match.
 */
export function resolveInput(input: string, catalog: FeedProduct[]): Resolved | null {
  const t = input.trim();
  if (!t) return null;
  let slug = "";
  try {
    if (/^https?:\/\//i.test(t)) slug = new URL(t).pathname.replace(/^\/+|\/+$/g, "").replace(/^product\//, "");
  } catch { /* not a URL */ }
  if (!slug && /^[a-z0-9-]+$/i.test(t) && t.includes("-")) slug = t;
  if (slug) {
    const hit = catalog.find((p) => p.link.replace(/\/+$/, "").endsWith(`/product/${slug}`));
    if (hit) return { ...hit, matchedOn: hit.link, score: 1 };
  }
  return resolveOne(t, catalog);
}

export function resolveAll(names: string[], catalog: FeedProduct[]) {
  return names.map((name) => ({ name, hit: resolveOne(name, catalog) }));
}
