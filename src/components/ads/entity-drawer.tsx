"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Drawer } from "@/components/ui/drawer";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { ConfigPanel, type EntityConfig } from "@/components/ads/config-panel";
import { EntityTrendChart } from "@/components/ads/entity-trend-chart";
import { brandTone } from "@/lib/brand-tone";
import type { PivotRow } from "@/lib/ads/store";
import { addNote, saveAnnotation, setAdStatusNow, type AdsFormState } from "@/app/(app)/t/[team]/ads/actions";
import { ToneTag } from "@/components/status-badge";

/**
 * One ad, with the numbers, the creative, and what a person has decided.
 *
 * The annotation panel is the part that was missing: `saveAnnotation` and
 * `addNote` existed with no UI at all, so a funnel could only be set by running
 * a seed script and production had zero annotations. Every funnel figure in the
 * workspace is downstream of this form.
 */

const EMPTY: AdsFormState = {};

type EntityInfo = {
  /** How Meta has this set up, from the `ad_entities` mirror. */
  config: EntityConfig | null;
  annotation: {
    funnel: string | null;
    purpose: string;
    audienceLabel: string;
    isEventAdSet: boolean;
    cirTargetPct: string | null;
    trelloUrl: string;
  } | null;
  notes: { id: string; body: string; source: string; createdAt: string }[];
};

export function EntityDrawer({
  row,
  teamSlug,
  range,
  onClose,
}: {
  row: PivotRow;
  teamSlug: string;
  range: { start: string; end: string };
  onClose: () => void;
}) {
  const [info, setInfo] = useState<EntityInfo | null>(null);
  const [annotationState, annotate, annotating] = useActionState(saveAnnotation, EMPTY);
  const [noteState, note, noting] = useActionState(addNote, EMPTY);
  const [statusState, setStatus, settingStatus] = useActionState(setAdStatusNow, EMPTY);

  // Deps are strings, never the row object: a fresh object every render would
  // re-fire this on every keystroke elsewhere in the tree.
  const key = `${row.brandId}|${row.level}|${row.id}`;
  const load = useCallback(async () => {
    const [brandId, level, entityId] = key.split("|");
    const res = await fetch(
      `/api/ads/entity?${new URLSearchParams({ team: teamSlug, brandId, level, entityId })}`,
    );
    if (res.ok) setInfo((await res.json()) as EntityInfo);
  }, [key, teamSlug]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, annotationState.ok, noteState.ok]);

  const t = row.totals;
  const money = (v: number) =>
    `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${row.currency}`;
  const stats: [string, string][] = [
    ["Spent", money(t.spend)],
    ["Purchases", String(t.purchases)],
    ["Conv. value", money(t.purchaseValue)],
    ["CIR", t.purchaseValue > 0 ? `${t.cir.toFixed(0)}%` : "—"],
    ["ROAS", t.spend > 0 ? `${t.roas.toFixed(2)}x` : "—"],
    ["CTR", t.outboundClicks > 0 ? `${t.ctr.toFixed(2)}%` : "—"],
  ];

  const hidden = (
    <>
      <input type="hidden" name="team" value={teamSlug} />
      <input type="hidden" name="brandId" value={row.brandId} />
      <input type="hidden" name="level" value={row.level} />
      <input type="hidden" name="entityId" value={row.id} />
      <input type="hidden" name="entityName" value={row.name} />
    </>
  );

  const paused = row.status === "PAUSED";
  const adsManager = `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${row.adAccountId.replace(/^act_/, "")}&selected_ad_ids=${row.id}`;

  return (
    <Drawer label={row.name} onClose={onClose} width={512}>
      <header className="flex items-start justify-between gap-3 border-b border-zinc-200 p-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
            {row.brandSlug && (
              <span className={`size-1.5 rounded-full ${brandTone(row.brandSlug).dot}`} />
            )}
            <span className="truncate">{row.name}</span>
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {[row.campaignName, row.adSetName, row.status].filter(Boolean).join(" · ")}
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
        <dl className="grid grid-cols-3 gap-3">
          {stats.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[0.65rem] text-zinc-500">{label}</dt>
              <dd className="text-sm font-medium tabular-nums text-zinc-900">{value}</dd>
            </div>
          ))}
        </dl>

        <EntityTrendChart
          teamSlug={teamSlug}
          brandId={row.brandId}
          level={row.level}
          entityId={row.id}
          range={range}
          currency={row.currency}
        />

        <ConfigPanel config={info?.config ?? null} level={row.level} />

        {row.creative && (
          <div className="flex gap-3 border-t border-zinc-100 pt-3">
            {row.creative.thumbnailUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.creative.thumbnailUrl}
                alt=""
                className="size-24 shrink-0 rounded object-cover ring-1 ring-zinc-200"
              />
            )}
            <div className="min-w-0 text-[0.7rem]">
              {row.creative.title && (
                <p className="font-medium text-zinc-800">{row.creative.title}</p>
              )}
              <p className="mt-0.5 line-clamp-4 text-zinc-600">{row.creative.body}</p>
              {row.creative.callToAction && (
                <p className="mt-1 text-zinc-400">{row.creative.callToAction}</p>
              )}
            </div>
          </div>
        )}

        {(row.assetType || row.messagingAngle || row.hookTactic) && (
          <div className="flex flex-wrap gap-1.5 border-t border-zinc-100 pt-3">
            {[row.assetType, row.messagingAngle, row.hookTactic].filter(Boolean).map((label) => (
              <ToneTag key={label} tone="info" label={String(label).replace(/_/g, " ")} />
            ))}
            {row.labelsOverridden && (
              <span className="text-[0.65rem] text-zinc-400">edited by a person</span>
            )}
          </div>
        )}

        {/* The annotation form: the only place a funnel becomes a decision. */}
        <form action={annotate} className="grid gap-2 border-t border-zinc-100 pt-3">
          {hidden}
          <p className="text-[0.7rem] font-medium text-zinc-700">What this is</p>

          {row.aiFunnel && (
            <p className="rounded bg-violet-50 px-2 py-1.5 text-[0.7rem] text-violet-800">
              The classifier reads this as {row.aiFunnel.stage}
              {row.aiFunnel.confidence ? ` (${(row.aiFunnel.confidence * 100).toFixed(0)}% sure)` : ""}.
              Nobody has decided yet; picking below is what makes it count.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-[0.7rem] text-zinc-500">
              Funnel
              <select
                name="funnel"
                defaultValue={info?.annotation?.funnel ?? row.aiFunnel?.stage ?? ""}
                className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
              >
                <option value="">Not set</option>
                <option value="TOF">TOF</option>
                <option value="MOF">MOF</option>
                <option value="BOF">BOF</option>
              </select>
            </label>
            <label className="text-[0.7rem] text-zinc-500">
              Purpose
              <input
                name="purpose"
                defaultValue={info?.annotation?.purpose ?? row.purpose}
                placeholder="BAU, PAYDAY, 11.11…"
                className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
              />
            </label>
            <label className="text-[0.7rem] text-zinc-500">
              Audience
              <input
                name="audienceLabel"
                defaultValue={info?.annotation?.audienceLabel ?? row.audienceLabel}
                className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
              />
            </label>
            <label className="text-[0.7rem] text-zinc-500">
              CIR target %
              <input
                name="cirTargetPct"
                type="number"
                step="1"
                defaultValue={info?.annotation?.cirTargetPct ?? ""}
                placeholder="funnel default"
                className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[0.7rem] text-zinc-600">
            <input type="hidden" name="hasEventToggle" value="1" />
            <input
              type="checkbox"
              name="isEventAdSet"
              value="1"
              defaultChecked={info?.annotation?.isEventAdSet ?? row.isEventAdSet}
              className="size-3.5 rounded border-zinc-300"
            />
            Event ad set. The efficiency rules skip it, because a sale ad set is
            meant to spend before it converts.
          </label>

          <Button type="submit" label="Save" variant="primary" size="sm" isDisabled={annotating} />
          {annotationState.error && (
            <p className="text-[0.7rem] text-red-600">{annotationState.error}</p>
          )}
          {annotationState.ok && (
            <p className="text-[0.7rem] text-emerald-700">{annotationState.ok}</p>
          )}
          <p className="text-[0.65rem] text-zinc-400">{row.funnelExplanation}</p>
        </form>

        <div className="border-t border-zinc-100 pt-3">
          <p className="mb-1.5 text-[0.7rem] font-medium text-zinc-700">Notes</p>
          {info?.notes.length ? (
            <ul className="mb-2 grid gap-1.5">
              {info.notes.map((n) => (
                <li key={n.id} className="rounded bg-zinc-50 p-2 text-[0.7rem] text-zinc-600">
                  {n.body}
                  <span className="ml-1.5 text-zinc-400">
                    {new Date(n.createdAt).toLocaleDateString("en-PH", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-[0.7rem] text-zinc-400">Nothing recorded yet.</p>
          )}
          <form action={note} className="flex gap-2">
            {hidden}
            <input
              name="body"
              placeholder="Why you paused it, what you tried…"
              className="h-8 flex-1 rounded-md border border-zinc-200 px-2 text-xs"
            />
            <Button type="submit" label="Add" size="sm" isDisabled={noting} />
          </form>
          {noteState.error && <p className="mt-1 text-[0.7rem] text-red-600">{noteState.error}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
          {row.level === "ad" && row.writeOk ? (
            <form action={setStatus}>
              {hidden}
              <input type="hidden" name="currentStatus" value={row.status} />
              <input type="hidden" name="kind" value={paused ? "activate_ad" : "pause_ad"} />
              <ConfirmSubmitButton
                message={
                  paused
                    ? `Reactivate "${row.name}" on Meta?`
                    : `Pause "${row.name}" on Meta? It stops delivering immediately.`
                }
                tone={paused ? "default" : "danger"}
                isDisabled={settingStatus}
                variant="primary"
                label={paused ? "Reactivate ad" : "Pause ad"}
              />
            </form>
          ) : (
            row.level === "ad" && (
              <span
                className="text-[0.65rem] text-zinc-400"
                title="Enable writes for this account in Admin, Integrations."
              >
                Read-only account
              </span>
            )
          )}
          <Button
            href={adsManager}
            target="_blank"
            rel="noreferrer"
            label="Open in Ads Manager"
            icon={<Icon icon={ExternalLink} />}
            size="sm"
          />
          {statusState.error && <p className="text-[0.7rem] text-red-600">{statusState.error}</p>}
          {statusState.ok && <p className="text-[0.7rem] text-emerald-700">{statusState.ok}</p>}
        </div>
      </div>
    </Drawer>
  );
}
