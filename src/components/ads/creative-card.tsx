"use client";

import { ExternalLink, X } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Drawer } from "@/components/ui/drawer";

import { brandTone } from "@/lib/brand-tone";
import type { CreativeRow } from "@/lib/ads/creatives/library";
import { ToneTag } from "@/components/status-badge";

/** One creative, close up: what it says, what it cost, what it returned. */
export function CreativeCard({
  row,
  teamSlug,
  onClose,
}: {
  row: CreativeRow;
  teamSlug: string;
  onClose: () => void;
}) {
  const money = (v: number) =>
    `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${row.currency}`;
  const stats: [string, string][] = [
    ["Spent", money(row.spend)],
    ["Purchases", String(row.conversions)],
    ["Value", money(row.revenue)],
    ["CIR", row.revenue > 0 ? `${row.cir.toFixed(0)}%` : "—"],
    ["ROAS", row.spend > 0 ? `${row.roas.toFixed(2)}x` : "—"],
    ["CTR", row.clicks > 0 ? `${row.ctr.toFixed(2)}%` : "—"],
    ["Hook rate", row.hookRate > 0 ? `${row.hookRate.toFixed(1)}%` : "—"],
    ["Hold rate", row.holdRate > 0 ? `${row.holdRate.toFixed(1)}%` : "—"],
    ["Days active", String(row.daysActive)],
  ];

  return (
    <Drawer label={row.adName} onClose={onClose}>
      <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
            <span className={`size-1.5 rounded-full ${brandTone(row.brandSlug).dot}`} />
            <span className="truncate">{row.adName}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {[row.campaignName, row.adSetName, row.effectiveStatus].filter(Boolean).join(" · ")}
          </p>
        </div>
        <IconButton
          label="Close"
          icon={<Icon icon={X} />}
          variant="ghost"
          size="sm"
          onClick={onClose}
        />
      </header>

      <div className="space-y-4 p-4">
        {(row.imageUrl || row.thumbnailUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.imageUrl ?? row.thumbnailUrl ?? ""}
            alt=""
            onError={(e) => (e.currentTarget.style.display = "none")}
            className="max-h-72 w-full rounded-lg object-contain ring-1 ring-zinc-200"
          />
        )}

        {(row.title || row.body) && (
          <div className="text-[0.75rem]">
            {row.title && <p className="font-medium text-zinc-800">{row.title}</p>}
            {row.body && <p className="mt-1 whitespace-pre-wrap text-zinc-600">{row.body}</p>}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {[row.assetType, row.messagingAngle, row.hookTactic].filter(Boolean).map((l) => (
            <ToneTag key={String(l)} tone="info" label={String(l).replace(/_/g, " ")} />
          ))}
          {row.funnel ? (
            <ToneTag label={`${row.funnel} (decided)`} />
          ) : row.aiFunnelStage ? (
            <ToneTag tone="info" label={`AI says ${row.aiFunnelStage}, nobody has decided`} />
          ) : null}
        </div>

        <dl className="grid grid-cols-3 gap-3 border-t border-zinc-100 pt-3">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[0.65rem] text-zinc-500">{label}</dt>
              <dd className="text-sm font-medium tabular-nums text-zinc-900">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
          <Button
            href={`/t/${teamSlug}/ads/performance?${new URLSearchParams({
              brands: row.brandSlug,
              level: "ad",
              adset: row.adSetId,
            })}`}
            label="See it in Performance"
            variant="primary"
            size="sm"
          />
          <Button
            href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${row.adAccountId.replace(/^act_/, "")}&selected_ad_ids=${row.adId}`}
            target="_blank"
            rel="noreferrer"
            label="Ads Manager"
            icon={<Icon icon={ExternalLink} />}
            size="sm"
          />
        </div>
      </div>
    </Drawer>
  );
}
