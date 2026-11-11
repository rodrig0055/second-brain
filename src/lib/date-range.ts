/**
 * One date window, for every surface that shows numbers over time.
 *
 * Before this there were three conventions: Insights ran 7/30/90 ending today,
 * the ads cockpit ran 7/14/30/90 ending yesterday, and the social panel was a
 * hardcoded 28 days. Two of those disagree about whether "today" counts, which
 * matters: today is still being delivered, so including it makes every ad look
 * like it had a bad day and every post look like it underperformed.
 *
 * Dates are `YYYY-MM-DD` strings, inclusive at both ends, in the business
 * timezone (Asia/Manila) unless a caller passes its own — an ad account reports
 * in its own timezone and its "yesterday" is not ours.
 *
 * Pure: no db, no React, safe to import from a client component.
 */

export const BUSINESS_TZ = "Asia/Manila";

export type SearchParamsLike = Record<string, string | string[] | undefined>;

export type DatePresetKey =
  | "7d"
  | "14d"
  | "28d"
  | "30d"
  | "90d"
  | "this-month"
  | "last-month";

export const DATE_PRESETS: readonly { key: DatePresetKey; label: string; days?: number }[] = [
  { key: "7d", label: "7 days", days: 7 },
  { key: "14d", label: "14 days", days: 14 },
  { key: "28d", label: "28 days", days: 28 },
  { key: "30d", label: "30 days", days: 30 },
  { key: "90d", label: "90 days", days: 90 },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
];

const PRESET_KEYS = new Set<string>(DATE_PRESETS.map((p) => p.key));

/** The query keys this module owns. Controls strip all of them before setting new ones. */
export const DATE_RANGE_KEYS = ["range", "from", "to", "compare"] as const;

export type DateWindow = { start: string; end: string };

export type ResolvedDateRange = {
  start: string;
  end: string;
  /** Inclusive length in days. */
  days: number;
  preset: DatePresetKey | "custom";
  compare: boolean;
  /** Equal-length window ending the day before `start`. Present only when `compare`. */
  prev?: DateWindow;
  label: string;
  /** "vs previous 28 days" — only when `compare`. */
  compareLabel?: string;
  endsYesterday: boolean;
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(value: unknown): value is string {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  // Rejects 2026-02-31, which Date.parse would roll forward.
  return new Date(t).toISOString().slice(0, 10) === value;
}

/**
 * Today in `timeZone`, as YYYY-MM-DD. The en-CA locale formats as YYYY-MM-DD,
 * which is the same idiom `src/lib/loops/clock.ts` and `buildSystemPrompt` use.
 * An unknown timezone throws in Intl, so fall back to UTC rather than take the
 * whole page down over a bad config value.
 */
export function todayIn(timeZone: string = BUSINESS_TZ, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Day arithmetic on the string, via UTC midnight so DST never shifts a date. */
export function addDays(ymd: string, n: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10);
}

/** Inclusive day count from `a` to `b`. Same day = 1. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.floor(ms / 86_400_000) + 1;
}

export function dateSpan(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The equal-length window ending the day before `start`. */
export function previousWindow(start: string, end: string): DateWindow {
  const len = daysBetween(start, end);
  const prevEnd = addDays(start, -1);
  return { start: addDays(prevEnd, -(len - 1)), end: prevEnd };
}

/** First and last day of the month containing `ymd`, shifted by `offsetMonths`. */
export function monthBounds(ymd: string, offsetMonths = 0): DateWindow {
  const [y, m] = ymd.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  const last = new Date(Date.UTC(y, m + offsetMonths, 0));
  return {
    start: first.toISOString().slice(0, 10),
    end: last.toISOString().slice(0, 10),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(ymd: string): { d: number; m: number; y: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y, m, d };
}

/** "1–16 Sep 2026", "28 Aug – 16 Sep 2026", "16 Sep 2026". */
export function formatRangeLabel(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

export function presetLabel(key: DatePresetKey): string {
  const preset = DATE_PRESETS.find((p) => p.key === key);
  if (!preset) return key;
  return preset.days ? `Last ${preset.days} days` : preset.label;
}

/**
 * The window a preset means, anchored on `today`. `endsYesterday` moves the
 * anchor back a day first: a rolling "last 7 days" that stops yesterday, and a
 * "this month" that stops yesterday rather than showing a partial today.
 */
export function presetWindow(
  key: DatePresetKey,
  today: string,
  endsYesterday: boolean,
): DateWindow {
  const anchor = endsYesterday ? addDays(today, -1) : today;
  const preset = DATE_PRESETS.find((p) => p.key === key);
  if (preset?.days) return { start: addDays(anchor, -(preset.days - 1)), end: anchor };
  if (key === "last-month") return monthBounds(today, -1);
  // this-month: clamp the end to the anchor so we never claim days that have
  // not happened. On the 1st with endsYesterday the anchor is in the previous
  // month, so the window collapses to that single day rather than inverting.
  const bounds = monthBounds(today, 0);
  const end = anchor < bounds.end ? anchor : bounds.end;
  return { start: bounds.start > end ? end : bounds.start, end };
}

function one(sp: SearchParamsLike, key: string): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

export type ParseDateRangeOptions = {
  /** Fallback window length when nothing is in the URL. Ignored if `defaultPreset` is set. */
  defaultDays?: number;
  defaultPreset?: DatePresetKey;
  /** True for ad/post data, where today is still accruing. */
  endsYesterday?: boolean;
  /** Inject for tests, or pass the ad account's own today. */
  today?: string;
  timeZone?: string;
  maxDays?: number;
  now?: Date;
};

/**
 * Read a window out of the URL. Precedence: explicit custom `from`/`to`, then a
 * named or numeric `range`, then the caller's default. Anything invalid falls
 * through to the next rule rather than erroring — a bad param in a shared link
 * should show the default window, not a 500.
 */
export function parseDateRange(
  sp: SearchParamsLike,
  opts: ParseDateRangeOptions = {},
): ResolvedDateRange {
  const {
    defaultDays = 28,
    defaultPreset,
    endsYesterday = false,
    timeZone = BUSINESS_TZ,
    maxDays = 366,
    now,
  } = opts;
  const today = opts.today ?? todayIn(timeZone, now);
  const anchor = endsYesterday ? addDays(today, -1) : today;
  const compare = ["1", "true", "yes"].includes((one(sp, "compare") ?? "").toLowerCase());

  let start: string;
  let end: string;
  let preset: DatePresetKey | "custom";

  const rawFrom = one(sp, "from");
  const rawTo = one(sp, "to");
  const rawRange = one(sp, "range");

  if (isYmd(rawFrom) && isYmd(rawTo)) {
    // Swap rather than reject: a hand-edited URL with the dates backwards still
    // means one obvious window.
    let from = rawFrom as string;
    let to = rawTo as string;
    if (from > to) [from, to] = [to, from];
    if (to > anchor) to = anchor;
    if (from > to) from = to;
    if (daysBetween(from, to) > maxDays) from = addDays(to, -(maxDays - 1));
    start = from;
    end = to;
    preset = "custom";
  } else {
    let key: DatePresetKey | null = null;
    if (rawRange && PRESET_KEYS.has(rawRange)) {
      key = rawRange as DatePresetKey;
    } else if (rawRange && /^\d+$/.test(rawRange)) {
      // Legacy `?range=30` (Insights) and `?days=14` (ads) links.
      const match = DATE_PRESETS.find((p) => p.days === Number(rawRange));
      key = match ? match.key : null;
    }
    if (!key) {
      const legacyDays = one(sp, "days");
      if (legacyDays && /^\d+$/.test(legacyDays)) {
        const match = DATE_PRESETS.find((p) => p.days === Number(legacyDays));
        key = match ? match.key : null;
      }
    }
    if (!key) {
      key = defaultPreset ?? DATE_PRESETS.find((p) => p.days === defaultDays)?.key ?? "28d";
    }
    const win = presetWindow(key, today, endsYesterday);
    start = win.start;
    end = win.end;
    preset = key;
  }

  const days = daysBetween(start, end);
  const label = preset === "custom" ? formatRangeLabel(start, end) : presetLabel(preset);
  const prev = compare ? previousWindow(start, end) : undefined;

  return {
    start,
    end,
    days,
    preset,
    compare,
    prev,
    label,
    compareLabel: compare ? `vs previous ${days} days` : undefined,
    endsYesterday,
  };
}

/** The canonical query params for a range, for building links. */
export function dateRangeParams(range: ResolvedDateRange): Record<string, string> {
  const out: Record<string, string> =
    range.preset === "custom"
      ? { from: range.start, to: range.end }
      : { range: range.preset };
  if (range.compare) out.compare = "1";
  return out;
}
