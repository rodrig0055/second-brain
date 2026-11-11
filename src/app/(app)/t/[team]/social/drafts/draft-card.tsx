"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, ExternalLink, Loader2, User as UserIcon } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { StatusBadge } from "@/components/status-badge";
import { brandTone } from "@/lib/brand-tone";
import {
  cancelFacebookSchedule,
  discardDraft,
  publishDraftNow,
  restoreDraft,
  scheduleDraftOnFacebook,
  setPlannedFor,
  updateDraft,
  type SocialActionState,
} from "../actions";

/**
 * One draft, and everything you can do to it.
 *
 * Which buttons appear is decided by the status, because the states are not
 * interchangeable: a Meta-held post has to be cancelled before it can be
 * anything else, and a stalled publish offers to finish rather than to start
 * again, which is the difference between one post and two.
 */

export type DraftCardModel = {
  id: string;
  brandId: string;
  brandName: string;
  brandSlug: string;
  status: string;
  channel: string;
  mediaType: string;
  caption: string;
  mediaUrls: string[];
  linkUrl: string | null;
  firstComment: string;
  altText: string;
  rationale: string;
  agentDrafted: boolean;
  authorName: string;
  publisherName: string;
  permalink: string | null;
  error: string | null;
  igMediaId: string | null;
  fbPostId: string | null;
  igContainerId: string | null;
  plannedFor: string | null;
  scheduledAtLabel: string | null;
  publishAttempts: number;
  isStalled: boolean;
  createdAt: string;
  publishedAt: string | null;
};

const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook Page",
  both: "Instagram + Facebook",
};

const EMPTY: SocialActionState = {};

export function DraftCard({ draft, teamSlug }: { draft: DraftCardModel; teamSlug: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  const [publishState, publish, publishing] = useActionState(publishDraftNow, EMPTY);
  const [discardState, discard, discarding] = useActionState(discardDraft, EMPTY);
  const [restoreState, restore, restoring] = useActionState(restoreDraft, EMPTY);
  const [editState, edit, savingEdit] = useActionState(updateDraft, EMPTY);
  const [scheduleState, schedule, scheduling] = useActionState(scheduleDraftOnFacebook, EMPTY);
  const [cancelState, cancel, cancelling] = useActionState(cancelFacebookSchedule, EMPTY);
  const [planState, plan, planning] = useActionState(setPlannedFor, EMPTY);

  const busy =
    publishing || discarding || restoring || savingEdit || scheduling || cancelling || planning;
  const feedback =
    publishState.error ??
    discardState.error ??
    restoreState.error ??
    editState.error ??
    scheduleState.error ??
    cancelState.error ??
    planState.error ??
    publishState.ok ??
    scheduleState.ok ??
    cancelState.ok ??
    planState.ok ??
    editState.ok;
  const isError = Boolean(
    publishState.error ??
      discardState.error ??
      restoreState.error ??
      editState.error ??
      scheduleState.error ??
      cancelState.error ??
      planState.error,
  );

  const editable = draft.status === "draft" || draft.status === "failed";
  const canFinish = draft.isStalled || (draft.status === "failed" && draft.igContainerId);

  const hidden = (
    <>
      <input type="hidden" name="teamSlug" value={teamSlug} />
      <input type="hidden" name="draftId" value={draft.id} />
    </>
  );

  return (
    <li className="animate-enter rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`size-1.5 shrink-0 rounded-full ${brandTone(draft.brandSlug).dot}`} />
        <span className="text-xs font-medium text-zinc-800">{draft.brandName}</span>
        <StatusBadge status={draft.isStalled ? "failed" : draft.status} />
        <span className="text-[0.7rem] text-zinc-500">
          {CHANNEL_LABEL[draft.channel] ?? draft.channel} ·{" "}
          {draft.mediaType.charAt(0).toUpperCase() + draft.mediaType.slice(1)}
        </span>
        <div className="grow" />
        <span className="flex items-center gap-1 text-[0.7rem] text-zinc-400">
          {draft.agentDrafted ? (
            <>
              <Bot className="size-3" /> Drafted by the agent
            </>
          ) : (
            <>
              <UserIcon className="size-3" /> {draft.authorName || "Someone"}
            </>
          )}
        </span>
      </div>

      {draft.scheduledAtLabel && (
        <p className="mb-2 text-[0.7rem] text-sky-700">
          Facebook publishes this at {draft.scheduledAtLabel}. Meta is holding it, not us.
        </p>
      )}
      {draft.plannedFor && draft.status === "draft" && (
        <p className="mb-2 text-[0.7rem] text-zinc-500">
          Planned for {draft.plannedFor}. Nothing publishes it automatically; this is your
          reminder.
        </p>
      )}
      {draft.isStalled && (
        <p className="mb-2 flex items-center gap-1.5 text-[0.7rem] text-red-600">
          <Loader2 className="size-3" />
          Publishing started and did not finish. Finishing resumes the post already in flight; it
          will not post twice.
        </p>
      )}

      {editing ? (
        <form action={edit} className="grid gap-2">
          {hidden}
          <textarea
            name="caption"
            rows={5}
            defaultValue={draft.caption}
            className="w-full rounded-md border border-zinc-200 p-2 text-sm text-zinc-800 outline-none focus:border-zinc-400"
          />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[0.7rem] text-zinc-500">
              Channel
              <select
                name="channel"
                defaultValue={draft.channel}
                className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
              >
                <option value="instagram">Instagram</option>
                <option value="facebook">Facebook Page</option>
                <option value="both">Instagram + Facebook</option>
                <option value="tiktok">TikTok</option>
              </select>
            </label>
            <label className="text-[0.7rem] text-zinc-500">
              Media type
              <select
                name="mediaType"
                defaultValue={draft.mediaType}
                className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
              >
                <option value="image">Image</option>
                <option value="video">Video / Reel</option>
                <option value="carousel">Carousel</option>
                <option value="text">Text (Facebook only)</option>
              </select>
            </label>
          </div>
          <label className="text-[0.7rem] text-zinc-500">
            Media URLs, one per line
            <textarea
              name="mediaUrls"
              rows={2}
              defaultValue={draft.mediaUrls.join("\n")}
              className="mt-1 w-full rounded-md border border-zinc-200 p-2 font-mono text-[0.7rem]"
            />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[0.7rem] text-zinc-500">
              First comment
              <input
                name="firstComment"
                defaultValue={draft.firstComment}
                className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
              />
            </label>
            <label className="text-[0.7rem] text-zinc-500">
              Planned for
              <input
                type="date"
                name="plannedFor"
                defaultValue={draft.plannedFor ?? ""}
                className="mt-1 block h-8 w-full rounded-md border border-zinc-200 px-2 text-xs"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <Button
              label="Save"
              variant="primary"
              size="sm"
              type="submit"
              isDisabled={busy}
            />
            <Button
              label="Cancel"
              size="sm"
              onClick={() => setEditing(false)}
            />
          </div>
        </form>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-sm text-zinc-700">
            {draft.caption || <span className="text-zinc-400">(no caption)</span>}
          </p>

          {draft.mediaUrls.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {draft.mediaUrls.map((u) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img loading="lazy" decoding="async" key={u} src={u} alt="" className="size-20 rounded object-cover ring-1 ring-zinc-200" />
              ))}
            </div>
          )}

          {draft.firstComment && (
            <p className="mt-2 rounded bg-zinc-50 p-2 text-[0.7rem] text-zinc-600">
              First comment: {draft.firstComment}
            </p>
          )}
          {draft.rationale && (
            <p className="mt-2 rounded bg-zinc-50 p-2 text-[0.7rem] text-zinc-600">
              Why: {draft.rationale}
            </p>
          )}
          {draft.error && !draft.isStalled && (
            <p className="mt-2 rounded bg-red-50 p-2 text-[0.7rem] text-red-600">{draft.error}</p>
          )}

          {(draft.igMediaId || draft.fbPostId) && draft.status !== "scheduled" && (
            <p className="mt-2 text-[0.7rem] text-emerald-700">
              Live on {[draft.igMediaId && "Instagram", draft.fbPostId && "Facebook"].filter(Boolean).join(" and ")}
              {draft.publishedAt ? ` · ${draft.publishedAt}` : ""}
              {draft.publisherName ? ` · ${draft.publisherName}` : ""}
            </p>
          )}
          {draft.permalink && (
            <a
              href={draft.permalink}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-[0.7rem] text-zinc-500 hover:text-zinc-800"
            >
              <ExternalLink className="size-3" />
              View post
            </a>
          )}
        </>
      )}

      {!editing && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
          {(editable || canFinish) && (
            <form action={publish}>
              {hidden}
              <Button
                label={canFinish ? "Finish publishing" : draft.status === "failed" ? "Retry" : "Publish now"}
                variant="primary"
                size="sm"
                type="submit"
                isDisabled={busy}
              />
            </form>
          )}

          {editable && draft.channel === "facebook" && (
            <form action={schedule} className="flex items-center gap-1.5">
              {hidden}
              <input
                type="datetime-local"
                name="scheduleAt"
                required
                className="h-7 rounded-md border border-zinc-200 px-1.5 text-[0.7rem]"
              />
              <Button
                label="Schedule on Facebook"
                size="sm"
                type="submit"
                isDisabled={busy}
              />
            </form>
          )}

          {draft.status === "scheduled" && (
            <form action={cancel}>
              {hidden}
              <Button
                label="Cancel schedule"
                size="sm"
                type="submit"
                isDisabled={busy}
              />
            </form>
          )}

          {editable && (
            <>
              <Button
                label="Edit"
                size="sm"
                onClick={() => setEditing(true)}
              />
              {!draft.plannedFor && (
                <form action={plan} className="flex items-center gap-1.5">
                  {hidden}
                  <input
                    type="date"
                    name="plannedFor"
                    required
                    className="h-7 rounded-md border border-zinc-200 px-1.5 text-[0.7rem]"
                  />
                  <Button
                    label="Plan a day"
                    size="sm"
                    type="submit"
                    isDisabled={busy}
                  />
                </form>
              )}
              <form action={discard}>
                {hidden}
                <Button
                  label="Discard"
                  variant="ghost"
                  size="sm"
                  type="submit"
                  isDisabled={busy}
                />
              </form>
            </>
          )}

          {draft.status === "discarded" && (
            <form action={restore}>
              {hidden}
              <Button
                label="Restore"
                size="sm"
                type="submit"
                isDisabled={busy}
              />
            </form>
          )}

          {draft.status === "published" && (
            <Button
              label="Draft a variation"
              size="sm"
              onClick={() =>
                router.push(
                  `/t/${teamSlug}/social/compose?draft=${draft.id}&brand=${draft.brandId}`,
                )
              }
            />
          )}

          {draft.publishAttempts > 1 && (
            <span className="text-[0.65rem] text-zinc-400">
              {draft.publishAttempts} attempts
            </span>
          )}
        </div>
      )}

      {feedback && (
        <p className={`mt-2 text-[0.7rem] ${isError ? "text-red-600" : "text-emerald-700"}`}>
          {feedback}
        </p>
      )}
    </li>
  );
}
