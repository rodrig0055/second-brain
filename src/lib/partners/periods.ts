/**
 * Sales periods. "Bi-weekly" here is the half-month: the 1st to the 15th and
 * the 16th to month end. Two of them always make exactly one month, so the
 * half-month view adds up to the monthly one partners report in.
 */
import { addDays } from "@/lib/date-range";

export type Grain = "half" | "month";
export type Period = { key: string; start: string; end: string; label: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function periodOf(ymd: string, grain: Grain): Period {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  const ym = `${y}-${pad(m)}`;
  const last = lastDayOfMonth(y, m);
  const mon = MONTHS[m - 1];
  if (grain === "month") {
    return { key: ym, start: `${ym}-01`, end: `${ym}-${pad(last)}`, label: `${mon} ${y}` };
  }
  return d <= 15
    ? { key: `${ym}-1`, start: `${ym}-01`, end: `${ym}-15`, label: `1-15 ${mon}` }
    : { key: `${ym}-2`, start: `${ym}-16`, end: `${ym}-${pad(last)}`, label: `16-${last} ${mon}` };
}

/** The `n` periods ending with the one holding `today`, oldest first. */
export function recentPeriods(today: string, grain: Grain, n: number): Period[] {
  const out: Period[] = [periodOf(today, grain)];
  while (out.length < n) out.unshift(periodOf(addDays(out[0].start, -1), grain));
  return out;
}
