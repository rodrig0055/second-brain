/**
 * Deterministic checks on ad copy, before a person reads it.
 *
 * Separate from the SEO lint because the rules are different in kind: a meta
 * title is measured against what Google truncates, an ad headline against what
 * Meta truncates and what the team found converts.
 *
 * The rule that earns this module its place is the stale sale check. The Ad
 * Marketing Funnel sheet currently contains a 9.9 ad whose caption reads "Don't
 * forget the 8.8 Super Sale this August 8!" — copy carried over from the
 * previous sale and never updated. It went live. Nothing about that is visible
 * to a spell check or to an LLM reviewer asked whether the copy is good, but it
 * is trivially visible to a string comparison against the sale being run.
 */

export type CopySeverity = "error" | "warn";

export type CopyFinding = {
  severity: CopySeverity;
  field: "headline" | "primaryText" | "description";
  message: string;
};

export type CopyDraft = {
  headline: string;
  primaryText: string;
  description?: string;
  /** PAYDAY | 9.9 | GRANDPARENTS | BAU … the sale this ad is for. */
  purpose?: string;
  /** When the sale lands, if it has a date. */
  eventDate?: string;
};

export type CopyLintConfig = {
  /** Meta truncates the headline around here. Hard limit. */
  headlineMax: number;
  /** The doc's target band: 25-40 characters. */
  headlineTargetMin: number;
  headlineTargetMax: number;
  /**
   * Characters before "See more…" folds the primary text. The doc's rule is to
   * keep the important information ahead of that point.
   */
  primaryTextFold: number;
  bannedTerms: string[];
};

export const DEFAULT_COPY_LINT: CopyLintConfig = {
  headlineMax: 60,
  headlineTargetMin: 25,
  headlineTargetMax: 40,
  primaryTextFold: 125,
  bannedTerms: [],
};

/**
 * Double-digit sale names: 8.8, 9.9, 11.11, 12.12.
 *
 * Both halves must match, which is what makes these sale names rather than
 * prices or decimals. "2.5x ROAS" and "P1.5" do not match; neither does a date
 * written 9.15. This is the convention the process doc calls "double digit".
 */
const SALE_TOKEN = /\b(\d{1,2})\.(\d{1,2})\b/g;

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const MONTH_DAY = new RegExp(`\\b(${MONTHS.join("|")})\\s+(\\d{1,2})\\b`, "gi");

/** Sale tokens mentioned in a piece of copy, e.g. ["8.8"]. */
export function saleTokens(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(SALE_TOKEN)) {
    if (match[1] === match[2]) out.push(match[0]);
  }
  return [...new Set(out)];
}

/** Month-and-day references, normalised to "august 8". */
export function dateMentions(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(MONTH_DAY)) {
    out.push(`${match[1].toLowerCase()} ${Number(match[2])}`);
  }
  return [...new Set(out)];
}

/** The month and day an event lands on, as "september 9". */
function eventMonthDay(eventDate: string): string | null {
  const parsed = new Date(`${eventDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${MONTHS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}`;
}

/**
 * Check one draft's copy.
 *
 * Errors block; warnings are shown and can be shipped past. The split follows
 * what is objectively wrong versus what is merely off the team's preferred
 * shape: a headline over Meta's limit gets cut off mid-word in the ad, while a
 * headline of 22 characters is simply shorter than they usually write.
 */
export function lintAdCopy(
  draft: CopyDraft,
  config: CopyLintConfig = DEFAULT_COPY_LINT,
): CopyFinding[] {
  const findings: CopyFinding[] = [];
  const headline = draft.headline.trim();
  const primary = draft.primaryText.trim();

  // --- headline length ---
  if (headline.length === 0) {
    findings.push({
      severity: "error",
      field: "headline",
      message: "No headline.",
    });
  } else if (headline.length > config.headlineMax) {
    findings.push({
      severity: "error",
      field: "headline",
      message:
        `Headline is ${headline.length} characters. Meta cuts it off past ` +
        `${config.headlineMax}, so the end will not be read.`,
    });
  } else if (
    headline.length < config.headlineTargetMin ||
    headline.length > config.headlineTargetMax
  ) {
    findings.push({
      severity: "warn",
      field: "headline",
      message:
        `Headline is ${headline.length} characters, outside the ` +
        `${config.headlineTargetMin}-${config.headlineTargetMax} band the team writes to.`,
    });
  }

  // --- primary text ---
  if (primary.length === 0) {
    findings.push({
      severity: "error",
      field: "primaryText",
      message: "No primary text.",
    });
  } else {
    const fold = primary.slice(0, config.primaryTextFold);
    const tail = primary.slice(config.primaryTextFold);
    // A price or an offer after the fold is information most readers never
    // see, because "See more…" hides it.
    const offerAfterFold =
      /(₱|P\s?\d|\d+%\s*off|free\s+(same-day\s+)?delivery|as low as)/i.test(tail) &&
      !/(₱|P\s?\d|\d+%\s*off|free\s+(same-day\s+)?delivery|as low as)/i.test(fold);
    if (offerAfterFold) {
      findings.push({
        severity: "warn",
        field: "primaryText",
        message:
          `The offer appears after the first ${config.primaryTextFold} characters, ` +
          "where See more hides it. Lead with it.",
      });
    }
  }

  // --- the stale sale check ---
  const body = `${headline} ${primary} ${draft.description ?? ""}`;
  const purpose = (draft.purpose ?? "").trim();
  const mentionedSales = saleTokens(body);
  const purposeIsSale = /^\d{1,2}\.\d{1,2}$/.test(purpose);

  for (const token of mentionedSales) {
    if (purposeIsSale && token !== purpose) {
      findings.push({
        severity: "error",
        field: "primaryText",
        message:
          `This is a ${purpose} ad but the copy says ${token}. Copy carried ` +
          "over from the last sale.",
      });
    } else if (!purposeIsSale && purpose && purpose !== "BAU") {
      findings.push({
        severity: "warn",
        field: "primaryText",
        message: `Copy mentions the ${token} sale but this ad is for ${purpose}.`,
      });
    }
  }

  if (draft.eventDate) {
    const expected = eventMonthDay(draft.eventDate);
    for (const mention of dateMentions(body)) {
      if (expected && mention !== expected) {
        findings.push({
          severity: "error",
          field: "primaryText",
          message:
            `Copy says "${mention}" but this ad runs for ${expected}. ` +
            "Check the date before it goes live.",
        });
      }
    }
  }

  // --- unfilled placeholders ---
  // A writer asked for a date nobody gave leaves "[DATE]" behind, and the ad
  // brief does exactly this rather than inventing one. It is the right answer
  // while the draft is being edited and a humiliating one in a live ad, so it
  // blocks: the whole point of refusing to guess is that someone then fills it.
  for (const [field, text] of [
    ["headline", headline],
    ["primaryText", primary],
    ["description", (draft.description ?? "").trim()],
  ] as const) {
    const placeholders = text.match(/\[[A-Za-z0-9 _/-]{2,30}\]|\{\{[^}]{1,40}\}\}/g);
    for (const placeholder of placeholders ?? []) {
      findings.push({
        severity: "error",
        field,
        message: `${placeholder} was never filled in.`,
      });
    }
  }

  // --- banned terms ---
  for (const term of config.bannedTerms) {
    if (!term) continue;
    if (body.toLowerCase().includes(term.toLowerCase())) {
      findings.push({
        severity: "error",
        field: "primaryText",
        message: `Contains a banned term: "${term}".`,
      });
    }
  }

  return findings;
}

/** Whether a draft may be marked ready to run. */
export function blocksRelease(findings: CopyFinding[]): boolean {
  return findings.some((f) => f.severity === "error");
}
