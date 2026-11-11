"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { brandTone } from "@/lib/brand-tone";
import type { PivotRow } from "@/lib/ads/store";
import { COMPARE_COLUMNS, PERFORMANCE_COLUMNS } from "./performance-columns";
import { EntityDrawer } from "./entity-drawer";
import { ToneTag } from "@/components/status-badge";

/**
 * The pivot, on the shared table.
 *
 * Clicking a campaign row drills into its ad sets and an ad set into its ads,
 * because "which of these is the problem" is the question this table exists to
 * answer and it used to need a level switch and a scan.
 */
export function PerformanceTable({
  rows,
  level,
  teamSlug,
  multiBrand,
  compare,
  range,
  mixedCurrency,
}: {
  rows: PivotRow[];
  level: "campaign" | "adset" | "ad";
  teamSlug: string;
  multiBrand: boolean;
  compare: boolean;
  /** The table's window, which the drawer's chart plots day by day. */
  range: { start: string; end: string };
  mixedCurrency: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<PivotRow | null>(null);

  const identity: DataTableColumn<PivotRow>[] = [
    {
      key: "name",
      label: level === "campaign" ? "Campaign" : level === "adset" ? "Ad set" : "Ad",
      value: (r) => r.name,
      align: "left",
      lockVisible: true,
      sticky: true,
      searchable: true,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          {r.creative?.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={r.creative.thumbnailUrl}
              alt=""
              // Meta's CDN links expire; a dead one hides rather than showing a broken icon.
              onError={(e) => (e.currentTarget.style.display = "none")}
              className="size-8 shrink-0 rounded object-cover ring-1 ring-zinc-200"
            />
          )}
          <span className="min-w-0">
            <span className="block max-w-xs truncate text-zinc-900" title={r.name}>
              {r.name}
            </span>
            <span className="block truncate text-[0.65rem] text-zinc-400">
              {[r.status, r.purpose, level === "ad" ? r.adSetName : ""].filter(Boolean).join(" · ")}
            </span>
          </span>
          {r.level !== "ad" && (
            // Campaign and ad set rows drill in when clicked, which left their
            // configuration unreachable: budget, targeting and optimisation
            // goal live at exactly those two levels and nowhere else. This is
            // the way in without taking the drill-down away from the row.
            <Button
              label="Setup"
              aria-label={`Configuration for ${r.name}`}
              tooltip="Budget, schedule and targeting"
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(r);
              }}
              className="ml-auto shrink-0"
            />
          )}
        </span>
      ),
    },
    ...(multiBrand
      ? ([
          {
            key: "brand",
            label: "Account",
            value: (r) => r.brandName,
            align: "left" as const,
            render: (r) => (
              <span className="flex items-center gap-1.5 whitespace-nowrap">
                <span className={`size-1.5 rounded-full ${brandTone(r.brandSlug).dot}`} />
                {r.brandName}
              </span>
            ),
          },
        ] as DataTableColumn<PivotRow>[])
      : []),
    {
      key: "funnel",
      label: "Funnel",
      value: (r) => r.funnel ?? "unmapped",
      align: "left",
      render: (r) => (
        <span className="flex items-center gap-1 whitespace-nowrap">
          <span
            className={`rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${
              r.funnel
                ? r.funnelNeedsReview
                  ? "bg-amber-50 text-amber-700"
                  : "bg-zinc-100 text-zinc-700"
                : "bg-amber-50 text-amber-700"
            }`}
            title={r.funnelExplanation}
          >
            {r.funnel ?? "unmapped"}
            {r.funnelNeedsReview ? "?" : ""}
          </span>
          {r.aiFunnel && (
            <ToneTag tone="info" tooltip={`The classifier suggests ${r.aiFunnel.stage}. Nobody has decided yet.`} label={`AI ${r.aiFunnel.stage}`} />
          )}
        </span>
      ),
    },
    ...(mixedCurrency
      ? ([
          {
            key: "currency",
            label: "Currency",
            value: (r) => r.currency,
            align: "left" as const,
            defaultVisible: false,
          },
        ] as DataTableColumn<PivotRow>[])
      : []),
    {
      key: "status",
      label: "Status",
      value: (r) => r.status || null,
      align: "left",
      defaultVisible: false,
    },
    {
      key: "objective",
      label: "Objective",
      value: (r) => r.objective || null,
      align: "left",
      defaultVisible: false,
    },
  ];

  const columns = [
    ...identity,
    ...PERFORMANCE_COLUMNS,
    ...(compare ? COMPARE_COLUMNS : []),
    {
      key: "lastSeen",
      label: "Last seen",
      value: (r: PivotRow) => r.lastSeen || null,
      align: "left" as const,
      defaultVisible: false,
    },
  ];

  function onRowClick(row: PivotRow) {
    // Campaign and ad set rows drill in; an ad is the bottom, so it opens.
    if (row.level === "campaign") {
      router.push(
        `/t/${teamSlug}/ads/performance?${new URLSearchParams({
          brands: row.brandSlug,
          level: "adset",
          campaign: row.id,
        })}`,
      );
      return;
    }
    if (row.level === "adset") {
      router.push(
        `/t/${teamSlug}/ads/performance?${new URLSearchParams({
          brands: row.brandSlug,
          level: "ad",
          adset: row.id,
        })}`,
      );
      return;
    }
    setOpen(row);
  }

  return (
    <>
      <DataTable
        id={`ads-performance-${level}`}
        label="Performance"
        legacyStorageKey="ads-pivot-columns"
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.brandId}:${r.id}`}
        defaultSort={{ key: "spend", dir: "desc" }}
        search={{ placeholder: "Search names" }}
        onRowClick={onRowClick}
        csv={{ filename: `meta-${level}` }}
        emptyLabel="Nothing delivered in this window."
        footnote={
          mixedCurrency
            ? "This selection spans more than one currency, so there is no total row. Each figure is in its own account's currency."
            : level === "ad"
              ? "A rate with no denominator shows as a dash, not a zero. A starred frequency means the window spans several days, so reach is a sum."
              : "Click a row to drill in, or Setup to see its budget and targeting."
        }
      />
      {open && <EntityDrawer row={open} teamSlug={teamSlug} range={range} onClose={() => setOpen(null)} />}
    </>
  );
}
