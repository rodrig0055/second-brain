/**
 * Deterministic content lint — the mechanical half of the review gate.
 *
 * This runs before any model call and produces *evidence*, not a verdict. It
 * only checks what a regex can actually settle: a character we never ship, a
 * length limit, a term the brand has banned, an unfilled placeholder. Judgment
 * about what the findings mean belongs to the reviewer pass (see review.ts),
 * which is why nothing here decides whether a draft ships.
 *
 * The split matters because the two halves fail differently. A linter is exact
 * and stupid: it will flag "delve" inside a customer quote. A reviewer is
 * flexible and unreliable: it will wave through a wrong price. Each is checked
 * by the other rather than trusted alone.
 *
 * Severity is the contract with the reviewer:
 *   error — settled by counting, not opinion. A 61-character meta title is over
 *           a 45-character limit and no amount of context changes that.
 *   warn  — a real signal that needs a human read. A banned phrase inside a
 *           sourced customer quote is a false positive, and only the reviewer
 *           can see that.
 */

export type LintSeverity = "error" | "warn";

export type LintFinding = {
  rule: string;
  severity: LintSeverity;
  /** What is wrong, in the plainest terms. */
  message: string;
  /** The offending text, so a reviewer can judge without re-reading the draft. */
  excerpt: string;
  /** 1-indexed line in the draft, when locatable. */
  line?: number;
};

export type LintConfig = {
  /**
   * Max characters for a meta/SEO title. Google truncates around 60, but the
   * Bloomly storefront CMS rejects longer than this, so it is a hard gate rather
   * than a preference.
   */
  metaTitleMax: number;
  /** Max characters for a meta description. */
  metaDescriptionMax: number;
  /** Brand-specific terms that must never appear. Sourced from doc metadata. */
  bannedTerms: string[];
  /** Set false for internal-facing output where an em dash is fine. */
  forbidEmDash: boolean;
};

export const DEFAULT_LINT_CONFIG: LintConfig = {
  metaTitleMax: 45,
  metaDescriptionMax: 160,
  bannedTerms: [],
  forbidEmDash: true,
};

/**
 * Phrases that read as machine-written. Deliberately short and specific:
 * a long list of "AI words" flags ordinary English and trains people to ignore
 * the gate. Every entry here is a fixed phrase, not a single common adjective,
 * so a hit is nearly always real. All `warn` — a customer might have said it.
 */
const SLOP_PHRASES = [
  "in today's fast-paced world",
  "in today's digital age",
  "unlock the power of",
  "elevate your",
  "take your .{0,30} to the next level",
  "look no further",
  "the perfect blend of",
  "nestled in the heart of",
  "a testament to",
  "in conclusion",
  "it's important to note that",
  "when it comes to",
  "we've got you covered",
  "game-?changer",
  "delve into",
];

/** Text that should never survive into a delivered draft. */
const PLACEHOLDER_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\{\{\s*[\w-]+\s*\}\}/g, label: "unfilled {{variable}}" },
  { re: /\[(?:insert|your|brand|product|todo)[^\]]{0,40}\]/gi, label: "bracketed placeholder" },
  { re: /\b(?:TODO|TBD|FIXME|XXX)\b/g, label: "TODO marker" },
  { re: /lorem ipsum/gi, label: "lorem ipsum" },
];

/** Labels a template might use for the two length-capped SEO fields. */
const META_TITLE_LABELS = ["meta title", "seo title", "page title", "title tag"];
const META_DESC_LABELS = ["meta description", "seo description", "meta desc"];

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

const clip = (s: string, max = 120) =>
  s.length > max ? `${s.slice(0, max)}…` : s;

/**
 * Pull the value of a labelled field, e.g. `**Meta title:** Fresh Roses Manila`.
 * Returns null when the draft has no such field, which is the normal case for a
 * blog post or a newsletter and must not be treated as a violation.
 */
function labelledValue(text: string, labels: string[]): { value: string; index: number } | null {
  for (const label of labels) {
    // Optional markdown emphasis around the label, then a colon.
    const re = new RegExp(`^[ \\t>*_-]*\\**\\s*${label}\\s*\\**\\s*:\\s*(.+)$`, "im");
    const m = re.exec(text);
    if (m?.[1]) {
      // Strip trailing emphasis and surrounding quotes the model may add.
      const value = m[1]
        .trim()
        .replace(/^\**|\**$/g, "")
        .replace(/^["'“”](.*)["'“”]$/, "$1")
        .trim();
      if (value) return { value, index: m.index };
    }
  }
  return null;
}

/**
 * A number, price, percentage, or date in the draft. These are what the
 * reviewer must verify: a wrong figure is wrong however well the copy reads,
 * and unlike tone it cannot be judged from the text alone.
 */
export type ExtractedFact = {
  text: string;
  line: number;
};

const FACT_PATTERNS = [
  // Currency: PHP 1,299 / ₱1,299 / $19.99 / SGD 40 / THB 990 / ₫250,000
  /(?:PHP|SGD|THB|VND|USD|MYR|IDR|[₱$₫฿])\s?\d[\d,.]*/g,
  // Percentages and multiples: 40% / 4.5x
  /\b\d+(?:\.\d+)?\s?(?:%|x\b)/g,
  // Bare quantities with a unit or a magnitude word
  /\b\d[\d,.]*\s?(?:k|m|bn|million|billion|days?|weeks?|months?|years?|hours?|mins?|minutes?|orders?|customers?|reviews?|stems?|pcs?|pieces?)\b/gi,
  // Years and ISO dates
  /\b(?:19|20)\d{2}(?:-\d{2}-\d{2})?\b/g,
];

export function extractFacts(text: string): ExtractedFact[] {
  const seen = new Set<string>();
  const out: ExtractedFact[] = [];
  for (const re of FACT_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const value = m[0].trim();
      const key = `${value}@${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: value, line: lineOf(text, m.index ?? 0) });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

export type LintResult = {
  findings: LintFinding[];
  facts: ExtractedFact[];
  errorCount: number;
  warnCount: number;
};

export function lintContent(
  draft: string,
  config: LintConfig = DEFAULT_LINT_CONFIG,
): LintResult {
  const findings: LintFinding[] = [];
  const add = (f: LintFinding) => findings.push(f);

  // 1. Em dash. A house rule, and settled by counting.
  if (config.forbidEmDash) {
    for (const m of draft.matchAll(/—/g)) {
      const i = m.index ?? 0;
      add({
        rule: "em-dash",
        severity: "error",
        message: "Em dash. Use a comma, colon, or two sentences.",
        excerpt: clip(draft.slice(Math.max(0, i - 45), i + 45)),
        line: lineOf(draft, i),
      });
    }
  }

  // 2. Length caps on the two SEO fields the CMS actually rejects. Absence of
  //    the field is not a finding: most drafts have no meta title.
  const title = labelledValue(draft, META_TITLE_LABELS);
  if (title && title.value.length > config.metaTitleMax) {
    add({
      rule: "meta-title-length",
      severity: "error",
      message: `Meta title is ${title.value.length} characters, limit is ${config.metaTitleMax}.`,
      excerpt: clip(title.value),
      line: lineOf(draft, title.index),
    });
  }
  const desc = labelledValue(draft, META_DESC_LABELS);
  if (desc && desc.value.length > config.metaDescriptionMax) {
    add({
      rule: "meta-description-length",
      severity: "error",
      message: `Meta description is ${desc.value.length} characters, limit is ${config.metaDescriptionMax}.`,
      excerpt: clip(desc.value),
      line: lineOf(draft, desc.index),
    });
  }

  // 3. Placeholders. Nothing that says TODO is finished work.
  for (const { re, label } of PLACEHOLDER_PATTERNS) {
    for (const m of draft.matchAll(re)) {
      add({
        rule: "placeholder",
        severity: "error",
        message: `Unresolved ${label} left in the draft.`,
        excerpt: clip(m[0]),
        line: lineOf(draft, m.index ?? 0),
      });
    }
  }

  // 4. Brand-banned terms. The brand said never, so this is an error — but the
  //    reviewer can still keep one that sits inside a sourced customer quote.
  for (const term of config.bannedTerms) {
    if (!term.trim()) continue;
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    for (const m of draft.matchAll(re)) {
      const i = m.index ?? 0;
      add({
        rule: "banned-term",
        severity: "error",
        message: `"${term}" is on this brand's banned list.`,
        excerpt: clip(draft.slice(Math.max(0, i - 45), i + 45)),
        line: lineOf(draft, i),
      });
    }
  }

  // 5. Machine-written phrasing. Warn only: the reviewer decides.
  for (const phrase of SLOP_PHRASES) {
    const re = new RegExp(phrase, "gi");
    for (const m of draft.matchAll(re)) {
      add({
        rule: "slop-phrase",
        severity: "warn",
        message: `"${m[0]}" reads as machine-written.`,
        excerpt: clip(m[0]),
        line: lineOf(draft, m.index ?? 0),
      });
    }
  }

  return {
    findings,
    facts: extractFacts(draft),
    errorCount: findings.filter((f) => f.severity === "error").length,
    warnCount: findings.filter((f) => f.severity === "warn").length,
  };
}
