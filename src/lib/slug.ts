// Shared slugify used for knowledge-doc slugs (see admin/knowledge/actions.ts
// and scripts/backfill-doc-slugs.ts). Matches the convention already used for
// team/department slugs (admin/teams/actions.ts).
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Given a desired slug and the set of slugs already taken within the same
// scope, return a unique slug by appending -2, -3, … on collision.
export function dedupeSlug(desired: string, taken: Set<string>): string {
  const base = desired || "doc";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
