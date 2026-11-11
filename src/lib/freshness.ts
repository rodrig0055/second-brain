/**
 * Doc freshness — when a knowledge doc should be looked at again.
 *
 * A context doc is a photograph of a moving thing: the catalog changes, promos
 * expire, playbooks drift from what the team actually does. Without a shelf life
 * a doc is trusted forever, and the agent quotes a year-old offer rule as current.
 *
 * Two deliberate design choices:
 *
 * 1. **Cadence is derived from `kind`, never stored.** The due date is
 *    `asOf + cadence(kind)`, computed on read. Nothing to backfill, nothing to
 *    keep in sync, and retuning a dial is a one-line edit here rather than a
 *    migration over every row.
 * 2. **"As of" reuses columns we already have.** `verifiedAt` (stamped by the
 *    weekly ingest when it re-derives a doc from source data) if present, else
 *    `updatedAt`. A machine-maintained doc is only as fresh as its last
 *    verification; a human doc is as fresh as its last edit.
 *
 * A doc can opt out or retune via `metadata`:
 *   { "evergreen": true }   → never goes stale
 *   { "refreshDays": 30 }   → override the cadence for this doc only
 */

/**
 * Days before a doc of each kind should be revisited. `null` = evergreen.
 *
 * These are the dials. Tune them here.
 */
export const REFRESH_CADENCE_DAYS: Record<string, number | null> = {
  // The data underneath these moves constantly.
  "wiki-page": 7, // weekly data digest, rewritten by ingest
  catalog: 90, // products, prices, availability
  "offer-rules": 90, // promos and discounts expire

  // These accumulate rather than lurch.
  playbook: 180,
  winner: 180,

  // Identity and procedure rarely shift.
  "brand-voice": 365,
  "brand-lens": 365,
  "image-guidelines": 365,
  skill: 365,

  // Not calendar-governed.
  "master-prompt": null, // the behavioral contract, changed deliberately
  lesson: null, // governed by the review gate and the weekly lint, not a clock
  "wiki-index": null, // deterministic TOC, regenerated on demand, never injected
};

/**
 * Only stamp fast-moving docs with an "as of" date in the system prompt. A
 * brand-voice doc on a 365-day cadence gains the agent nothing and costs tokens
 * on every call; a 90-day catalog genuinely needs the caveat.
 */
export const PROMPT_STAMP_MAX_CADENCE_DAYS = 90;

/**
 * How far ahead of the due date to warn. Scaled to the cadence, not flat: a flat
 * 14-day window would mark the 7-day digest "due soon" the moment it is written,
 * so it could never once read as fresh and the warning would mean nothing. A
 * quarter of the shelf life, capped at two weeks, gives every cadence a real
 * fresh period and a proportionate heads-up.
 */
export const DUE_SOON_MAX_DAYS = 14;

export function dueSoonWindowDays(cadenceDays: number): number {
  return Math.min(DUE_SOON_MAX_DAYS, Math.max(1, Math.ceil(cadenceDays / 4)));
}

const DAY_MS = 86_400_000;

export type FreshnessState = "fresh" | "due-soon" | "overdue" | "evergreen";

/** The subset of a knowledge doc row this module needs. */
export type FreshnessInput = {
  kind: string;
  updatedAt: Date;
  verifiedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
};

export type Freshness = {
  /** When the content was last confirmed or edited. */
  asOf: Date;
  /** When it should be revisited, or null when evergreen. */
  refreshBy: Date | null;
  state: FreshnessState;
  /** Positive when overdue, negative when still fresh, null when evergreen. */
  daysOverdue: number | null;
  cadenceDays: number | null;
};

/** YYYY-MM-DD. Deterministic, so it is safe in the cached prompt prefix. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Effective cadence for a doc, honouring per-doc metadata overrides. */
export function cadenceDaysFor(doc: FreshnessInput): number | null {
  const meta = doc.metadata ?? {};
  if (meta.evergreen === true) return null;
  const override = meta.refreshDays;
  if (typeof override === "number" && Number.isFinite(override) && override > 0) {
    return override;
  }
  // An unknown kind has no dial yet: treat it as evergreen rather than inventing
  // a deadline that would show up as a false alarm the moment someone adds a kind.
  return REFRESH_CADENCE_DAYS[doc.kind] ?? null;
}

/** When the doc's content was last confirmed against reality. */
export function asOfDate(doc: FreshnessInput): Date {
  return doc.verifiedAt ?? doc.updatedAt;
}

export function freshnessOf(doc: FreshnessInput, now: Date = new Date()): Freshness {
  const asOf = asOfDate(doc);
  const cadenceDays = cadenceDaysFor(doc);

  if (cadenceDays === null) {
    return { asOf, refreshBy: null, state: "evergreen", daysOverdue: null, cadenceDays };
  }

  const refreshBy = new Date(asOf.getTime() + cadenceDays * DAY_MS);
  const daysOverdue = Math.floor((now.getTime() - refreshBy.getTime()) / DAY_MS);
  const warnFrom = -dueSoonWindowDays(cadenceDays);
  const state: FreshnessState =
    daysOverdue >= 0 ? "overdue" : daysOverdue >= warnFrom ? "due-soon" : "fresh";

  return { asOf, refreshBy, state, daysOverdue, cadenceDays };
}

/**
 * The "as of" suffix for a doc header in the system prompt, or "" when the doc
 * is evergreen or slow-moving enough that the stamp is not worth the tokens.
 *
 * CACHE-CRITICAL: this returns a stored date only. It must never include a
 * value computed from the current time (an "overdue" flag, a countdown), or the
 * stable prompt prefix would change daily and prompt caching would silently
 * switch off for the entire prompt. Staleness is judged in /admin/health, where
 * "now" is allowed. See scripts/check-prompt-cache-prefix.ts.
 */
export function promptStamp(doc: FreshnessInput): string {
  const cadenceDays = cadenceDaysFor(doc);
  if (cadenceDays === null || cadenceDays > PROMPT_STAMP_MAX_CADENCE_DAYS) return "";
  return ` — as of ${isoDay(asOfDate(doc))}`;
}
