/**
 * Reading and writing the brand scope in a URL.
 *
 * Kept apart from brand-scope.ts so it can be unit-tested and imported from a
 * client component without pulling `db` and `cookies()` into the graph.
 */

export const SCOPE_PARAM = "brands";
export const SCOPE_ALL = "all";

export type SearchParamsLike = Record<string, string | string[] | undefined>;

/** `all`, or specific brands. Never empty: an empty selection is `null`. */
export type ScopeSelection = { all: true } | { all: false; slugs: string[] };

export function scopeCookieName(teamSlug: string): string {
  return `ws-brands.${teamSlug}`;
}

function one(sp: SearchParamsLike, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Parse a `brands=` value (or a cookie, same format). Junk reads as null. */
export function parseScopeValue(raw: string | string[] | undefined): ScopeSelection | null {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value) return null;
  if (value.toLowerCase() === SCOPE_ALL) return { all: true };
  const slugs = [...new Set(value.split(",").map((s) => s.trim()).filter(Boolean))];
  return slugs.length ? { all: false, slugs: slugs.sort() } : null;
}

export function encodeScopeValue(selection: ScopeSelection): string {
  return selection.all ? SCOPE_ALL : [...selection.slugs].sort().join(",");
}

/**
 * Narrow a selection to what this user can actually see. Anything they cannot
 * see is dropped rather than refused: a link shared by someone with wider
 * access should show the overlap, not a 404.
 */
export function applySelection<B extends { id: string; slug: string }>(
  all: B[],
  selection: ScopeSelection,
  allowAll: boolean,
): B[] | null {
  if (selection.all) return allowAll ? all : all.slice(0, 1);
  const wanted = new Set(selection.slugs);
  const hit = all.filter((b) => wanted.has(b.slug));
  if (hit.length === 0) return null;
  return allowAll ? hit : hit.slice(0, 1);
}

/**
 * The selection the URL asks for. `brands=` wins; `brand=` is the legacy form
 * the ads, social and insights pages used and takes an id or a slug.
 */
export function selectionFromSearchParams(
  sp: SearchParamsLike,
  all: { id: string; slug: string }[],
): ScopeSelection | null {
  const fromBrands = parseScopeValue(one(sp, SCOPE_PARAM));
  if (fromBrands) return fromBrands;

  const legacy = one(sp, "brand")?.trim();
  if (!legacy) return null;
  const match = all.find((b) => b.id === legacy || b.slug === legacy);
  return match ? { all: false, slugs: [match.slug] } : null;
}

/** What clicking a chip should select next. */
export function toggleSlug(
  current: ScopeSelection,
  slug: string,
  allSlugs: string[],
  mode: "single" | "multi",
): ScopeSelection {
  if (mode === "single") return { all: false, slugs: [slug] };

  const selected = new Set(current.all ? allSlugs : current.slugs);
  if (selected.has(slug)) {
    // Never empty: the last selected chip stays on.
    if (selected.size === 1) return current;
    selected.delete(slug);
  } else {
    selected.add(slug);
  }
  const slugs = [...selected].sort();
  return slugs.length === allSlugs.length ? { all: true } : { all: false, slugs };
}

/** Rebuild a path with some params replaced and others dropped. */
export function withQuery(
  pathname: string,
  current: Record<string, string>,
  patch: Record<string, string | null | undefined> = {},
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) if (v) q.set(k, v);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined || v === "") q.delete(k);
    else q.set(k, v);
  }
  const qs = q.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/**
 * A `returnTo` is only ever a path inside this team's own surface. Guards the
 * scope action against being used as an open redirect.
 */
export function safeReturnTo(teamSlug: string, candidate: string, fallback: string): string {
  if (!candidate.startsWith(`/t/${teamSlug}`)) return fallback;
  if (candidate.startsWith("//") || candidate.includes("\\") || candidate.includes("://")) {
    return fallback;
  }
  return candidate;
}
