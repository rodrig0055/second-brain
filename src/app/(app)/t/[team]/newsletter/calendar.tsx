import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";

import { campaignPath } from "@/lib/newsletter/access";
import { STATUS_LABEL } from "@/lib/newsletter/store";
import { brandTone, statusStyle, toneLegend } from "@/lib/newsletter/brand-tone";
import { WEEKDAY_NAME } from "@/lib/newsletter/framework";

export type CalendarEntry = {
  id: string;
  sendDate: string;
  subject: string;
  status: string;
  brandName: string;
  brandSlug: string;
  errors: number;
};

const MONTH_NAME = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** "2026-09" to a UTC date at the first of that month. Bad input falls to today. */
function monthStart(month: string | undefined): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  const now = new Date();
  if (!m) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

function shift(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}

/**
 * The schedule as a month.
 *
 * A list tells you what exists; a calendar tells you what is missing, which is
 * the question a planner actually asks. Brand owns the colour and status reads
 * as weight, so the two never compete for the same cue.
 */
export function Calendar({
  entries, month, basePath,
}: {
  entries: CalendarEntry[];
  month?: string;
  basePath: string;
}) {
  const start = monthStart(month);
  const key = ym(start);
  const today = ymd(new Date());

  const byDate = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.sendDate) ?? [];
    list.push(e);
    byDate.set(e.sendDate, list);
  }

  // Monday-first grid. getUTCDay is Sunday-first, so Sunday becomes the 7th column.
  const firstWeekday = (start.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: Array<{ date: string; day: number } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: ymd(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), d))), day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const inMonth = entries.filter((e) => e.sendDate.startsWith(key));

  return (
    <section className="rounded-lg border border-zinc-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-900">
          {MONTH_NAME[start.getUTCMonth()]} {start.getUTCFullYear()}
        </h2>
        <span className="text-xs text-zinc-500">
          {inMonth.length} send{inMonth.length === 1 ? "" : "s"} scheduled
        </span>
        <span className="ml-auto flex items-center gap-1">
          <IconButton href={`${basePath}?m=${ym(shift(start, -1))}`} label="Previous month" size="sm"
            icon={<Icon icon="chevronLeft" />} />
          <Button href={basePath} label="Today" size="sm" />
          <IconButton href={`${basePath}?m=${ym(shift(start, 1))}`} label="Next month" size="sm"
            icon={<Icon icon="chevronRight" />} />
        </span>
      </div>

      <div className="grid grid-cols-7 border-b border-zinc-100 text-[0.6875rem] uppercase tracking-wide text-zinc-400">
        {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
          <div key={wd} className="px-2 py-1.5 text-center">{WEEKDAY_NAME[wd].slice(0, 3)}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="min-h-24 border-b border-r border-zinc-100 bg-zinc-50/60 last:border-r-0" />;
          const list = byDate.get(cell.date) ?? [];
          const isToday = cell.date === today;
          return (
            <div key={i} className="min-h-24 border-b border-r border-zinc-100 p-1.5 last:border-r-0">
              <div className={`mb-1 text-[0.6875rem] tabular-nums ${
                isToday ? "inline-flex size-5 items-center justify-center rounded-full bg-zinc-900 font-semibold text-zinc-50" : "text-zinc-400"
              }`}>
                {cell.day}
              </div>
              <div className="space-y-1">
                {list.map((e) => {
                  const tone = brandTone(e.brandSlug);
                  return (
                    <Link key={e.id} href={campaignPath(e.id)}
                      title={`${e.brandName} · ${STATUS_LABEL[e.status] ?? e.status}${e.subject ? ` · ${e.subject}` : ""}`}
                      className={`flex items-center gap-1 rounded px-1 py-0.5 text-[0.6875rem] leading-tight hover:brightness-95 ${tone.chip} ${statusStyle(e.status)}`}>
                      <span className={`size-1.5 shrink-0 rounded-full ${tone.dot}`} />
                      <span className="truncate">{tone.short}</span>
                      {e.errors > 0 && <span className="ml-auto shrink-0 font-semibold text-red-600">{e.errors}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-zinc-100 px-4 py-2.5 text-[0.6875rem] text-zinc-500">
        {toneLegend().map((t) => (
          <span key={t.slug} className="inline-flex items-center gap-1">
            <span className={`size-2 rounded-full ${t.dot}`} /> {t.short}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm ring-1 ring-inset ring-zinc-300" /> Draft
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm ring-1 ring-inset ring-amber-400" /> Needs art
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm ring-1 ring-inset ring-emerald-400" /> Approved
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-2.5 rounded-sm bg-zinc-300 opacity-55" /> Sent
          </span>
        </span>
      </div>
    </section>
  );
}
