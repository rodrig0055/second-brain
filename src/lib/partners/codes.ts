/**
 * Which partner a voucher code belongs to. Patterns are upper case with "*"
 * matching any run of characters: DIVEDEALS20 exactly, KRIS*PLUS* every
 * single-use Kris+ code.
 */

export function normalizePattern(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "").replace(/\*+/g, "*");
}

/** Comma, space or newline separated, deduplicated, empties dropped. */
export function parsePatterns(raw: string): string[] {
  return [...new Set(raw.split(/[\s,]+/).map(normalizePattern).filter((p) => p && p !== "*"))];
}

function toRegex(pattern: string): RegExp {
  const body = pattern
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`);
}

/** How specific a pattern is: its literal characters. An exact code beats any wildcard. */
function specificity(pattern: string): number {
  return pattern.includes("*") ? pattern.replace(/\*/g, "").length : 1000 + pattern.length;
}

/**
 * A code -> partner id matcher. When two partners' patterns both match, the
 * more specific pattern wins, so "KRIS*" and "KRIS130PLUS*" can coexist.
 */
export function codeMatcher(partners: { id: string; codes: string[] }[]) {
  const rules = partners
    .flatMap((p) => p.codes.map((c) => ({ id: p.id, re: toRegex(normalizePattern(c)), score: specificity(normalizePattern(c)) })))
    .sort((a, b) => b.score - a.score);
  return (code: string): string | undefined => {
    const c = code.trim().toUpperCase();
    return rules.find((r) => r.re.test(c))?.id;
  };
}
