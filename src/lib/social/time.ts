/**
 * Wall-clock time in a brand's timezone.
 *
 * A person scheduling a post means 7pm where they are, not 7pm UTC. The
 * scheduling input is a naive `YYYY-MM-DDTHH:mm`, and Meta wants a Unix second,
 * so something has to decide which instant that local time names.
 *
 * Done with Intl rather than a date library: we already depend on Intl for
 * every other date, and this is twenty lines.
 */

export const BUSINESS_TZ = "Asia/Manila";

/** The calendar day an instant falls on, in `timeZone`. */
export function dayIn(date: Date, timeZone: string = BUSINESS_TZ): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** A zone's offset from UTC at a given instant, in minutes. */
export function offsetMinutes(at: Date, timeZone: string = BUSINESS_TZ): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(at)) if (p.type !== "literal") parts[p.type] = p.value;
    // 24:00 happens in some locales; it means midnight of the same day.
    const hour = parts.hour === "24" ? "00" : parts.hour;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(hour),
      Number(parts.minute),
      Number(parts.second),
    );
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/**
 * The instant a local wall-clock time names.
 *
 * Two passes: guess with the offset now, then re-read the offset at that guess,
 * because a time on the far side of a DST change has a different offset from
 * the one in force today. Manila has no DST, but a brand in a zone that does
 * would otherwise land an hour out twice a year.
 */
export function wallClockToUtc(local: string, timeZone: string = BUSINESS_TZ): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(naive)) return null;

  let guess = new Date(naive - offsetMinutes(new Date(naive), timeZone) * 60_000);
  guess = new Date(naive - offsetMinutes(guess, timeZone) * 60_000);
  return guess;
}

/** An instant as the `YYYY-MM-DDTHH:mm` a datetime-local input expects. */
export function utcToWallClock(at: Date, timeZone: string = BUSINESS_TZ): string {
  const shifted = new Date(at.getTime() + offsetMinutes(at, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/**
 * Facebook accepts a scheduled post between 10 minutes and 75 days out.
 * Verified against the v25.0 reference for /feed and /photos.
 */
export const FB_SCHEDULE_MIN_MINUTES = 10;
export const FB_SCHEDULE_MAX_DAYS = 75;

export function fbScheduleWindow(now: Date = new Date()): { minAt: Date; maxAt: Date } {
  return {
    minAt: new Date(now.getTime() + FB_SCHEDULE_MIN_MINUTES * 60_000),
    maxAt: new Date(now.getTime() + FB_SCHEDULE_MAX_DAYS * 86_400_000),
  };
}

/** Why this instant cannot be given to Meta, or null when it can. */
export function fbScheduleProblem(at: Date, now: Date = new Date()): string | null {
  const { minAt, maxAt } = fbScheduleWindow(now);
  if (Number.isNaN(at.getTime())) return "That is not a valid date and time.";
  if (at < minAt) return "Facebook needs a time at least 10 minutes from now.";
  if (at > maxAt) return "Facebook cannot schedule more than 75 days ahead.";
  return null;
}

/** Unix seconds, which is what the Graph API takes. */
export function unixSeconds(at: Date): number {
  return Math.floor(at.getTime() / 1000);
}
