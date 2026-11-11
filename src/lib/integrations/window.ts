/**
 * Which dates a sync should re-read.
 *
 * Kept apart from sync.ts, which opens a database connection the moment it is
 * imported. This is arithmetic on dates and needs nothing, so it stays testable
 * without a DATABASE_URL.
 */
import type { SyncWindow } from "./types";

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Window from (lastSyncAt − the platform's restatement period) to today, or a
 * default lookback for a connection that has never synced.
 *
 * The overlap used to be a flat 2 days, which is shorter than Meta's 7-day
 * click window: a purchase clicked last Tuesday and bought today is credited
 * back to Tuesday, and a window starting 2 days ago never re-reads Tuesday. The
 * error only runs one way, so every ad looked permanently worse than it was,
 * and the kill rules are about to act on exactly these numbers.
 */
export function windowFor(
  conn: { lastSyncAt: Date | null },
  lookbackDays: number,
  restateDays = 2,
): SyncWindow {
  const end = new Date();
  const start = new Date();
  if (conn.lastSyncAt) {
    start.setTime(conn.lastSyncAt.getTime());
    start.setUTCDate(start.getUTCDate() - restateDays);
  } else {
    start.setUTCDate(start.getUTCDate() - lookbackDays);
  }
  // A lookback shorter than the restatement period would re-read less than the
  // platform can still change, which would make the restatement setting
  // decorative. Never start later than the restatement reaches back.
  const floor = new Date();
  floor.setUTCDate(floor.getUTCDate() - Math.max(lookbackDays, restateDays));
  if (!conn.lastSyncAt && start.getTime() > floor.getTime()) {
    start.setTime(floor.getTime());
  }
  return { start: ymd(start), end: ymd(end) };
}
