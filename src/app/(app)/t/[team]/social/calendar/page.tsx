import Link from "next/link";
import { ChevronLeft, ChevronRight, PlugZap } from "lucide-react";
import { IconButton } from "@astryxdesign/core/IconButton";

import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@/components/empty-state";
import { requireSocialTeam, socialPath } from "@/lib/social/access";
import { resolveBrandScope } from "@/lib/brand-scope";
import { todayIn } from "@/lib/date-range";
import { loadCalendarEntries } from "@/lib/social/drafts";
import { byDay, monthGrid, type CalendarEntry } from "@/lib/social/calendar";
import { brandTone } from "@/lib/brand-tone";
import { SocialToolbar } from "../toolbar";

/**
 * The month, across brands.
 *
 * The brand owns the colour, so what kind of thing an entry is reads as weight
 * instead: planned is outlined, Meta-scheduled has a ring, published is solid
 * and faded because it is done, failed is red.
 */

const KIND_STYLE: Record<CalendarEntry["kind"], string> = {
  planned: "border border-dashed border-zinc-300 bg-white text-zinc-600",
  meta_scheduled: "ring-1 ring-sky-300 bg-sky-50 text-sky-800",
  publishing: "ring-1 ring-blue-300 bg-blue-50 text-blue-700 animate-shimmer",
  published: "bg-zinc-100 text-zinc-500",
  failed: "ring-1 ring-red-300 bg-red-50 text-red-700",
};

const KIND_LABEL: Record<CalendarEntry["kind"], string> = {
  planned: "Planned, for you to post",
  meta_scheduled: "Facebook is holding this",
  publishing: "Publishing now",
  published: "Published",
  failed: "Failed",
};

function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export default async function SocialCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team: teamSlug } = await params;
  const sp = await searchParams;
  const { user, team, brands } = await requireSocialTeam(teamSlug);

  if (brands.length === 0) {
    return (
      <EmptyState
        icon={<PlugZap className="size-4" />}
        title="No connected social account"
        description="An admin connects a Meta Page under Admin, Integrations."
        action={<Button label="Go to Connections" variant="primary" href={socialPath("connections")} />}
      />
    );
  }

  const scope = await resolveBrandScope({ user, teamSlug: team.slug, searchParams: sp });
  const today = todayIn();
  const month = typeof sp.m === "string" && /^\d{4}-\d{2}$/.test(sp.m) ? sp.m : today.slice(0, 7);

  const days = monthGrid(month);
  const entries = await loadCalendarEntries(
    scope.selected.map((b) => b.id),
    days[0],
    days[days.length - 1],
  );
  const grouped = byDay(entries);

  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-PH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const navLink = (m: string) =>
    `${socialPath("calendar")}?${new URLSearchParams({ brands: scope.param, m })}`;

  return (
    <>
      <SocialToolbar
        scope={scope}
        pathname={socialPath("calendar")}
        query={{ m: month }}
        showDates={false}
      />

      <div className="mb-3 flex items-center gap-2">
        {/* Server component: lucide elements, not <Icon icon={...}>, since a
            component reference cannot cross into a client component. */}
        <IconButton
          label="Previous month"
          icon={<ChevronLeft className="size-full" aria-hidden />}
          size="sm"
          href={navLink(shiftMonth(month, -1))}
        />
        <span className="text-sm font-medium text-zinc-900">{monthLabel}</span>
        <IconButton
          label="Next month"
          icon={<ChevronRight className="size-full" aria-hidden />}
          size="sm"
          href={navLink(shiftMonth(month, 1))}
        />
        <div className="grow" />
        <div className="flex flex-wrap gap-2 text-[0.65rem] text-zinc-500">
          {(Object.keys(KIND_LABEL) as CalendarEntry["kind"][]).map((kind) => (
            <span key={kind} className="flex items-center gap-1">
              <span className={`inline-block size-2 rounded-sm ${KIND_STYLE[kind]}`} />
              {KIND_LABEL[kind]}
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-card">
        <div className="grid grid-cols-7 border-b border-zinc-200 bg-zinc-50">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <span key={d} className="px-2 py-1.5 text-[0.65rem] font-medium text-zinc-500">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const items = grouped.get(day) ?? [];
            const outside = !day.startsWith(month);
            return (
              <div
                key={day}
                className={`min-h-24 border-b border-r border-zinc-100 p-1.5 last:border-r-0 ${
                  outside ? "bg-zinc-50/50" : ""
                } ${day === today ? "bg-amber-50/40" : ""}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`text-[0.65rem] tabular-nums ${
                      outside ? "text-zinc-300" : day === today ? "font-semibold text-amber-700" : "text-zinc-400"
                    }`}
                  >
                    {Number(day.slice(-2))}
                  </span>
                  {!outside && (
                    <Link
                      href={`${socialPath("compose")}?plannedFor=${day}&brand=${scope.selected[0]?.id ?? ""}`}
                      className="text-[0.65rem] text-zinc-300 hover:text-zinc-700"
                      aria-label={`Plan a post for ${day}`}
                    >
                      +
                    </Link>
                  )}
                </div>
                <div className="grid gap-0.5">
                  {items.slice(0, 4).map((e) => (
                    <Link
                      key={`${e.source}-${e.id}`}
                      href={
                        e.source === "draft"
                          ? `${socialPath("drafts")}?brands=${scope.param}`
                          : `${socialPath("posts")}?brands=${scope.param}`
                      }
                      title={`${e.brandName} · ${KIND_LABEL[e.kind]} · ${e.caption}`}
                      className={`flex items-center gap-1 truncate rounded px-1 py-0.5 text-[0.65rem] ${KIND_STYLE[e.kind]}`}
                    >
                      <span className={`size-1.5 shrink-0 rounded-full ${brandTone(e.brandSlug).dot}`} />
                      <span className="truncate">{e.caption || "(no caption)"}</span>
                    </Link>
                  ))}
                  {items.length > 4 && (
                    <span className="px-1 text-[0.6rem] text-zinc-400">+{items.length - 4} more</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
