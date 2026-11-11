"use client";

import { useActionState } from "react";
import { Button } from "@astryxdesign/core/Button";

import {
  approveAndApply,
  rejectSet,
  type ChangeFormState,
} from "@/app/(app)/t/[team]/ads/changes/actions";
import type { ChangeSetView } from "@/lib/ads/change-sets/load";

const EMPTY: ChangeFormState = {};

/**
 * One set, as the person deciding on it needs to read it.
 *
 * Before and after sit next to each other on every row, because the question
 * is what changes rather than what the new value is. The impact line is above
 * the table rather than below it: somebody scanning an inbox decides whether to
 * read the detail from that one sentence.
 */
const STATE_TONE: Record<string, string> = {
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-blue-200 bg-blue-50 text-blue-800",
  applying: "border-blue-200 bg-blue-50 text-blue-800",
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
  partial: "border-amber-300 bg-amber-100 text-amber-900",
  rejected: "border-zinc-200 bg-zinc-100 text-zinc-600",
  cancelled: "border-zinc-200 bg-zinc-100 text-zinc-600",
};

const ROW_TONE: Record<string, string> = {
  done: "text-emerald-700",
  failed: "text-red-600",
  stale: "text-amber-700",
  outcome_unknown: "text-amber-700",
};

export function ChangeSetCard({
  set,
  teamSlug,
}: {
  set: ChangeSetView;
  teamSlug: string;
}) {
  const [approveState, approve, approving] = useActionState(approveAndApply, EMPTY);
  const [rejectState, reject, rejecting] = useActionState(rejectSet, EMPTY);
  // An approved-but-unapplied set keeps its buttons: the block is usually a
  // switch somebody can turn on, and then it wants applying rather than
  // re-approving.
  const decidable = set.state === "pending" || set.state === "approved";
  const busy = approving || rejecting;

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900">{set.reason || "Untitled set"}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {set.brandName} · {set.changes.length} change
            {set.changes.length === 1 ? "" : "s"} · proposed by{" "}
            {set.source === "rule" ? "a rule" : set.source === "agent" ? "the brain" : (set.proposedBy ?? "someone")}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            STATE_TONE[set.state] ?? STATE_TONE.pending
          }`}
        >
          {set.state === "partial"
            ? "partly applied"
            : set.state === "approved"
              ? "approved, not applied"
              : set.state}
        </span>
      </header>

      <p className="mt-2 text-xs font-medium text-zinc-700">{set.impact}</p>
      {set.expectation && (
        <p className="mt-1 text-xs text-zinc-500">Expected: {set.expectation}</p>
      )}
      {!set.guardrails.confirmed && (
        <p className="mt-1 text-[11px] text-amber-700">
          The limits this was checked against are not confirmed for this brand
          yet, so they are Acme Florals PH&apos;s numbers.
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-[11px] uppercase tracking-wide text-zinc-400">
              <th className="pb-1 pr-3 font-medium">What</th>
              <th className="pb-1 pr-3 font-medium">Now</th>
              <th className="pb-1 pr-3 font-medium">After</th>
              <th className="pb-1 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {set.changes.map((c) => (
              <tr key={c.id} className="border-b border-zinc-50 last:border-0">
                <td className="py-1.5 pr-3">
                  <span className="block max-w-xs truncate text-zinc-800" title={c.entityName}>
                    {c.entityName}
                  </span>
                  <span className="text-[11px] text-zinc-400">
                    {c.level} · {c.kind.replace(/_/g, " ")}
                  </span>
                  {c.caveat && (
                    <span className="mt-0.5 block text-[11px] text-amber-700">{c.caveat}</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 tabular-nums text-zinc-500">{c.before ?? "—"}</td>
                <td className="py-1.5 pr-3 font-medium tabular-nums text-zinc-900">
                  {c.after ?? "—"}
                </td>
                <td className={`py-1.5 ${ROW_TONE[c.state] ?? "text-zinc-400"}`}>
                  {c.state === "outcome_unknown" ? "unknown" : c.state}
                  {c.error && (
                    <span className="mt-0.5 block max-w-xs text-[11px] text-red-600">
                      {c.error}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(approveState.error || rejectState.error) && (
        <p className="mt-2 text-xs text-red-600">
          {approveState.error || rejectState.error}
        </p>
      )}
      {(approveState.ok || rejectState.ok) && (
        <p className="mt-2 text-xs text-emerald-700">{approveState.ok || rejectState.ok}</p>
      )}

      {decidable ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-zinc-100 pt-3">
          <form action={approve} className="flex items-end gap-2">
            <input type="hidden" name="team" value={teamSlug} />
            <input type="hidden" name="setId" value={set.id} />
            <input type="hidden" name="note" value="" />
            <Button
              type="submit"
              label={approving ? "Applying…" : "Approve and apply"}
              variant="primary"
              size="sm"
              isDisabled={busy}
            />
          </form>
          <form action={reject} className="flex flex-1 items-end gap-2">
            <input type="hidden" name="team" value={teamSlug} />
            <input type="hidden" name="setId" value={set.id} />
            <input
              name="reason"
              placeholder="Why not? The next pass reads this."
              className="min-w-0 flex-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
            />
            <Button type="submit" label="Reject" size="sm" isDisabled={busy} />
          </form>
        </div>
      ) : (
        set.decision && (
          <p className="mt-3 border-t border-zinc-100 pt-2 text-xs text-zinc-500">
            {set.decidedBy ?? "Someone"}: {set.decision}
          </p>
        )
      )}
    </article>
  );
}
