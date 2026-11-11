"use client";

import { useState } from "react";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";

import { DataTable, type DataTableColumn } from "@/components/data-table";
import { brandTone } from "@/lib/brand-tone";
import type { CreativeRow } from "@/lib/ads/creatives/library";
import { CreativeCard } from "./creative-card";
import { ToneTag } from "@/components/status-badge";

/**
 * Every creative that spent, as a grid or a table.
 *
 * The grid is for recognising an ad by its picture, which is how creative work
 * is actually discussed; the table is for sorting and exporting. Both show the
 * human funnel and the AI's guess side by side rather than reconciling them.
 */
export function CreativeLibrary({
  rows,
  teamSlug,
  multiBrand,
}: {
  rows: CreativeRow[];
  teamSlug: string;
  multiBrand: boolean;
}) {
  const [layout, setLayout] = useState<"grid" | "table">("grid");
  const [open, setOpen] = useState<CreativeRow | null>(null);

  const money = (v: number | string, r: CreativeRow) =>
    `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })} ${r.currency}`;

  const columns: DataTableColumn<CreativeRow>[] = [
    {
      key: "name",
      label: "Ad",
      value: (r) => r.adName,
      align: "left",
      lockVisible: true,
      sticky: true,
      searchable: true,
      render: (r) => (
        <span className="flex min-w-0 items-center gap-2">
          {r.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img loading="lazy" decoding="async" src={r.thumbnailUrl} alt="" className="size-8 shrink-0 rounded object-cover ring-1 ring-zinc-200" />
          )}
          <span className="block max-w-xs truncate" title={r.adName}>
            {r.adName}
          </span>
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
        ] as DataTableColumn<CreativeRow>[])
      : []),
    { key: "status", label: "Status", value: (r) => r.effectiveStatus || null, align: "left" },
    { key: "assetType", label: "Asset", value: (r) => r.assetType, align: "left" },
    { key: "angle", label: "Angle", value: (r) => r.messagingAngle, align: "left" },
    { key: "hook", label: "Hook", value: (r) => r.hookTactic, align: "left" },
    {
      key: "funnel",
      label: "Funnel",
      value: (r) => r.funnel ?? r.aiFunnelStage ?? null,
      align: "left",
      render: (r) => (
        <span className="whitespace-nowrap">
          {r.funnel ? (
            <ToneTag label={r.funnel} />
          ) : r.aiFunnelStage ? (
            <ToneTag tone="info" tooltip="The classifier's guess. Nobody has decided." label={`AI ${r.aiFunnelStage}`} />
          ) : (
            <span className="text-zinc-300">—</span>
          )}
        </span>
      ),
    },
    { key: "spend", label: "Spent", value: (r) => r.spend, format: money, numeric: true },
    {
      key: "cir",
      label: "CIR",
      value: (r) => (r.revenue > 0 ? r.cir : null),
      format: (v) => `${Number(v).toFixed(0)}%`,
      numeric: true,
      lowerIsBetter: true,
    },
    {
      key: "roas",
      label: "ROAS",
      value: (r) => (r.spend > 0 ? r.roas : null),
      format: (v) => `${Number(v).toFixed(2)}x`,
      numeric: true,
    },
    { key: "purchases", label: "Purch.", value: (r) => r.conversions, numeric: true },
    {
      key: "ctr",
      label: "CTR",
      value: (r) => (r.clicks > 0 ? r.ctr : null),
      format: (v) => `${Number(v).toFixed(2)}%`,
      numeric: true,
    },
    {
      key: "hookRate",
      label: "Hook rate",
      value: (r) => (r.hookRate > 0 ? r.hookRate : null),
      format: (v) => `${Number(v).toFixed(1)}%`,
      numeric: true,
      defaultVisible: false,
    },
    { key: "daysActive", label: "Days", value: (r) => r.daysActive, numeric: true },
    { key: "firstSeen", label: "First seen", value: (r) => r.firstSeen || null, align: "left", defaultVisible: false },
    { key: "lastSeen", label: "Last seen", value: (r) => r.lastSeen || null, align: "left", defaultVisible: false },
    {
      key: "classified",
      label: "Classified",
      value: (r) => (r.classifiedAt ? r.classifiedAt.toString().slice(0, 10) : null),
      align: "left",
      defaultVisible: false,
    },
  ];

  const toolbar = (
    <SegmentedControl
      label="Layout"
      value={layout}
      onChange={(v) => setLayout(v as "grid" | "table")}
      size="sm"
    >
      <SegmentedControlItem value="grid" label="Grid" />
      <SegmentedControlItem value="table" label="Table" />
    </SegmentedControl>
  );

  if (layout === "table") {
    return (
      <>
        <DataTable
          id="ads-creatives"
          label="Creatives"
          rows={rows}
          columns={columns}
          rowKey={(r) => `${r.brandId}:${r.adId}`}
          defaultSort={{ key: "spend", dir: "desc" }}
          search={{ placeholder: "Search ad names" }}
          onRowClick={setOpen}
          activeKey={open ? `${open.brandId}:${open.adId}` : null}
          csv={{ filename: "meta-creatives" }}
          toolbar={toolbar}
          emptyLabel="No creative spent in this window."
        />
        {open && <CreativeCard row={open} teamSlug={teamSlug} onClose={() => setOpen(null)} />}
      </>
    );
  }

  return (
    <>
      <div className="mb-2.5 flex items-center gap-2">
        {toolbar}
        <span className="text-xs tabular-nums text-zinc-400">{rows.length} creatives</span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-zinc-300 px-5 py-9 text-center text-xs text-zinc-500">
          No creative spent in this window.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((r) => (
            <ClickableCard
              key={`${r.brandId}:${r.adId}`}
              label={r.adName}
              onClick={() => setOpen(r)}
              padding={0}
              className={`overflow-hidden ${r.isWinner ? "border-emerald-200" : ""}`}
            >
              <span className="block aspect-[4/3] overflow-hidden bg-zinc-50">
                {r.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img loading="lazy" decoding="async" src={r.thumbnailUrl} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full items-center justify-center text-[0.7rem] text-zinc-300">
                    no preview
                  </span>
                )}
              </span>
              <span className="block p-2.5">
                <span className="flex items-center gap-1.5">
                  {multiBrand && (
                    <span className={`size-1.5 shrink-0 rounded-full ${brandTone(r.brandSlug).dot}`} />
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-900">
                    {r.adName}
                  </span>
                  {r.isWinner && (
                    <ToneTag tone="success" label="win" />
                  )}
                </span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {[r.assetType, r.messagingAngle, r.hookTactic].filter(Boolean).map((l) => (
                    <ToneTag key={String(l)} tone="info" label={String(l).replace(/_/g, " ")} />
                  ))}
                  {!r.classifiedAt && (
                    <span className="rounded bg-zinc-100 px-1 py-0.5 text-[0.6rem] text-zinc-500">
                      not classified
                    </span>
                  )}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-x-3 text-[0.65rem] tabular-nums text-zinc-500">
                  <span>
                    {r.spend.toLocaleString("en-US", { maximumFractionDigits: 0 })} {r.currency}
                  </span>
                  {r.revenue > 0 && <span>CIR {r.cir.toFixed(0)}%</span>}
                  {r.spend > 0 && <span>{r.roas.toFixed(2)}x</span>}
                  <span>{r.daysActive}d</span>
                </span>
              </span>
            </ClickableCard>
          ))}
        </div>
      )}
      {open && <CreativeCard row={open} teamSlug={teamSlug} onClose={() => setOpen(null)} />}
    </>
  );
}
