import Link from "next/link";
import { ArrowUpRight, Building2 } from "lucide-react";

import { brandTone } from "@/lib/brand-tone";
import type { HomeCard } from "@/lib/home-summaries";
import { TabIcon } from "@/components/tab-icon";
import { workspaceFor } from "@/lib/workspaces";

const STAT_TONES = {
  default: "text-zinc-900",
  warn: "text-amber-700",
  alert: "text-red-600",
} as const;

/**
 * One team on Home. A channel workspace shows the brands it is scoped to and
 * the one or two numbers that would make someone open it now; a generic team
 * keeps the plain row it always had.
 */
export function WorkspaceCard({ card }: { card: HomeCard }) {
  const workspace = workspaceFor(card.team.slug);
  const landingTab = workspace.tabs.find((t) => t.key === workspace.landing);

  return (
    <Link
      href={card.href}
      className="group flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-card hover:border-zinc-300"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200">
          {landingTab ? <TabIcon name={landingTab.icon} /> : <Building2 className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-zinc-900">{card.team.name}</p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">{card.team.department.name}</p>
        </div>
        <ArrowUpRight className="size-4 shrink-0 text-zinc-400 transition-transform duration-200 ease-smooth group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-zinc-800" />
      </div>

      {card.kind === "channel" && card.scopeLabel && (
        <div className="flex items-center gap-1.5">
          {card.brands.slice(0, 6).map((b) => (
            <span
              key={b.id}
              title={b.name}
              className={`size-1.5 rounded-full ${brandTone(b.slug).dot}`}
            />
          ))}
          <span className="text-[0.7rem] text-zinc-500">{card.scopeLabel}</span>
        </div>
      )}

      {card.summary?.stats.length ? (
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {card.summary.stats.slice(0, 2).map((stat) => (
            <span key={stat.label} className="flex items-baseline gap-1.5">
              <span
                className={`text-sm font-medium tabular-nums ${STAT_TONES[stat.tone ?? "default"]}`}
              >
                {stat.value}
              </span>
              <span className="text-[0.7rem] text-zinc-500">{stat.label}</span>
            </span>
          ))}
        </div>
      ) : (
        <span className="text-[0.7rem] text-zinc-400">
          {card.kind === "channel" ? "Nothing waiting" : "Chat · Tasks · Outputs"}
        </span>
      )}
    </Link>
  );
}
