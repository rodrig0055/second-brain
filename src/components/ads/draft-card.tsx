"use client";

import { useActionState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";

import type { AdsFormState } from "@/app/(app)/t/[team]/ads/actions";
import {
  archiveDraft,
  attachDraftAsset,
  removeDraftAsset,
  requestUpload,
  restoreDraft,
  updateDraft,
} from "@/app/(app)/t/[team]/ads/draft-actions";
import { brandTone } from "@/lib/brand-tone";
import { ToneTag } from "@/components/status-badge";

/**
 * One ad waiting to be made.
 *
 * States read as Draft, Uploaded and Archived. The stored values still say
 * requested and ready_to_run, but a specialist writing their own ads does not
 * have a request queue, and naming it one made the surface read like a ticket
 * system for a job one person does end to end.
 */

export type DraftAsset = { ratio: string; url: string; width?: number; height?: number };

export type AdDraftModel = {
  id: string;
  brandId: string;
  brandName: string;
  brandSlug: string;
  status: string;
  concept: string;
  purpose: string;
  eventDate: string | null;
  funnels: string[];
  headline: string;
  primaryText: string;
  description: string;
  callToAction: string;
  linkUrl: string;
  targetAdSetId: string;
  notes: string;
  assets: DraftAsset[];
  metaAdId: string | null;
  adAccountId: string;
  writeOk: boolean;
  findings: { severity: string; message: string }[];
  requestedAt: string;
};

const EMPTY: AdsFormState = {};
const RATIOS = ["1:1", "9:16"] as const;

const STATUS_LABEL: Record<string, string> = {
  requested: "Draft",
  ready_to_run: "Draft",
  failed_to_run: "Draft",
  uploading: "Uploading",
  uploaded: "Uploaded",
  archived: "Archived",
};

export function AdDraftCard({
  draft,
  teamSlug,
  adSets,
}: {
  draft: AdDraftModel;
  teamSlug: string;
  adSets: { id: string; name: string }[];
}) {
  const [saveState, save, saving] = useActionState(updateDraft, EMPTY);
  const [uploadState, upload, uploading] = useActionState(requestUpload, EMPTY);
  const [attachState, attach, attaching] = useActionState(attachDraftAsset, EMPTY);
  const [removeState, remove] = useActionState(removeDraftAsset, EMPTY);
  const [restoreState, restore] = useActionState(restoreDraft, EMPTY);
  const [archiveState, archive] = useActionState(archiveDraft, EMPTY);

  const errors = draft.findings.filter((f) => f.severity === "error");
  const warnings = draft.findings.filter((f) => f.severity !== "error");
  const byRatio = new Map(draft.assets.map((a) => [a.ratio, a]));
  const missing = RATIOS.filter((r) => !byRatio.has(r));
  const ready = errors.length === 0 && missing.length === 0;
  const editable = draft.status !== "uploaded" && draft.status !== "uploading";

  const hidden = (
    <>
      <input type="hidden" name="team" value={teamSlug} />
      <input type="hidden" name="brandId" value={draft.brandId} />
      <input type="hidden" name="draftId" value={draft.id} />
    </>
  );

  const feedback =
    saveState.error ??
    uploadState.error ??
    attachState.error ??
    removeState.error ??
    restoreState.error ??
    archiveState.error;
  const success =
    saveState.ok ??
    uploadState.ok ??
    attachState.ok ??
    removeState.ok ??
    restoreState.ok ??
    archiveState.ok;

  return (
    <article className="animate-enter rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className={`size-1.5 shrink-0 rounded-full ${brandTone(draft.brandSlug).dot}`} />
        <span className="text-xs font-medium text-zinc-800">{draft.brandName}</span>
        <ToneTag tone={draft.status === "uploaded" ? "success" : draft.status === "uploading" ? "progress" : "neutral"} label={STATUS_LABEL[draft.status] ?? draft.status} />
        {draft.funnels.map((f) => (
          <ToneTag key={f} label={f} />
        ))}
        {draft.purpose && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.65rem] text-zinc-600">
            {draft.purpose}
          </span>
        )}
        <div className="grow" />
        <span className="text-[0.65rem] text-zinc-400">{draft.requestedAt}</span>
      </header>

      <form action={save} className="grid gap-2">
        {hidden}
        <input
          name="concept"
          defaultValue={draft.concept}
          disabled={!editable}
          placeholder="What this ad is"
          className="h-8 w-full rounded-md border border-zinc-200 px-2 text-xs font-medium"
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[0.7rem] text-zinc-500">
            Headline
            <input
              name="headline"
              defaultValue={draft.headline}
              disabled={!editable}
              className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
            />
          </label>
          <label className="text-[0.7rem] text-zinc-500">
            Call to action
            <input
              name="callToAction"
              defaultValue={draft.callToAction}
              disabled={!editable}
              className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
            />
          </label>
        </div>
        <label className="text-[0.7rem] text-zinc-500">
          Primary text
          <textarea
            name="primaryText"
            rows={4}
            defaultValue={draft.primaryText}
            disabled={!editable}
            className="mt-1 w-full rounded-md border border-zinc-200 p-2 text-xs"
          />
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[0.7rem] text-zinc-500">
            Ad set
            <select
              name="targetAdSetId"
              defaultValue={draft.targetAdSetId}
              disabled={!editable}
              className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
            >
              <option value="">Not chosen</option>
              {adSets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[0.7rem] text-zinc-500">
            Link
            <input
              name="linkUrl"
              defaultValue={draft.linkUrl}
              disabled={!editable}
              className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
            />
          </label>
        </div>
        {editable && (
          <Button type="submit" label="Save copy" size="sm" isDisabled={saving} className="w-fit" />
        )}
      </form>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="mt-2 grid gap-1">
          {errors.map((f) => (
            <li key={f.message} className="rounded bg-red-50 px-2 py-1 text-[0.7rem] text-red-600">
              {f.message}
            </li>
          ))}
          {warnings.map((f) => (
            <li key={f.message} className="rounded bg-amber-50 px-2 py-1 text-[0.7rem] text-amber-700">
              {f.message}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 border-t border-zinc-100 pt-3">
        <p className="mb-1.5 text-[0.7rem] font-medium text-zinc-700">
          Assets
          {missing.length > 0 && (
            <span className="ml-1.5 font-normal text-amber-700">
              needs {missing.join(" and ")}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-3">
          {RATIOS.map((ratio) => {
            const asset = byRatio.get(ratio);
            return (
              <div key={ratio} className="w-28">
                <p className="mb-1 text-[0.65rem] text-zinc-500">{ratio}</p>
                {asset ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={asset.url}
                      alt=""
                      className={`w-full rounded object-cover ring-1 ring-zinc-200 ${
                        ratio === "1:1" ? "aspect-square" : "aspect-[9/16]"
                      }`}
                    />
                    {editable && (
                      <form action={remove} className="mt-1">
                        {hidden}
                        <input type="hidden" name="ratio" value={ratio} />
                        <Button type="submit" label="Remove" variant="ghost" size="sm" />
                      </form>
                    )}
                  </>
                ) : (
                  editable && (
                    <form action={attach}>
                      {hidden}
                      <input type="hidden" name="ratio" value={ratio} />
                      <label
                        className={`flex cursor-pointer items-center justify-center rounded border border-dashed border-zinc-300 text-[0.65rem] text-zinc-400 hover:border-zinc-400 ${
                          ratio === "1:1" ? "aspect-square" : "aspect-[9/16]"
                        }`}
                      >
                        Add
                        <input
                          type="file"
                          name="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        />
                      </label>
                    </form>
                  )
                )}
              </div>
            );
          })}
        </div>
        {attaching && <p className="mt-1 text-[0.65rem] text-zinc-400">Uploading…</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
        {editable &&
          (draft.writeOk ? (
            <form action={upload}>
              {hidden}
              <Button
                type="submit"
                label="Upload as a paused ad"
                variant="primary"
                size="sm"
                isDisabled={uploading || !ready}
                tooltip={
                  ready
                    ? "Creates the ad on Meta, paused"
                    : "Clear the errors and attach both ratios first"
                }
              />
            </form>
          ) : (
            <CopyBriefButton draft={draft} />
          ))}

        {draft.metaAdId && (
          <Button
            href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${draft.adAccountId.replace(/^act_/, "")}&selected_ad_ids=${draft.metaAdId}`}
            target="_blank"
            rel="noreferrer"
            label="See it in Ads Manager"
            icon={<Icon icon={ExternalLink} />}
            size="sm"
          />
        )}

        {editable ? (
          <form action={archive}>
            {hidden}
            <Button type="submit" label="Archive" variant="ghost" size="sm" />
          </form>
        ) : draft.status === "archived" ? (
          <form action={restore}>
            {hidden}
            <Button type="submit" label="Restore" size="sm" />
          </form>
        ) : null}

        {!draft.writeOk && editable && (
          <span className="text-[0.65rem] text-zinc-400">
            Writes are off for this account, so this one is made in Ads Manager.
          </span>
        )}
      </div>

      {feedback && <p className="mt-2 text-[0.7rem] text-red-600">{feedback}</p>}
      {success && !feedback && <p className="mt-2 text-[0.7rem] text-emerald-700">{success}</p>}
    </article>
  );
}

/** Everything needed to build this ad by hand, on the clipboard. */
function CopyBriefButton({ draft }: { draft: AdDraftModel }) {
  const text = [
    `Concept: ${draft.concept}`,
    draft.purpose && `Purpose: ${draft.purpose}`,
    draft.funnels.length && `Funnel: ${draft.funnels.join(", ")}`,
    draft.targetAdSetId && `Ad set: ${draft.targetAdSetId}`,
    "",
    `Headline: ${draft.headline}`,
    `Primary text: ${draft.primaryText}`,
    draft.description && `Description: ${draft.description}`,
    `CTA: ${draft.callToAction}`,
    draft.linkUrl && `Link: ${draft.linkUrl}`,
    "",
    ...draft.assets.map((a) => `${a.ratio}: ${a.url}`),
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Button
      label="Copy the brief"
      size="sm"
      onClick={() => void navigator.clipboard.writeText(text)}
    />
  );
}
