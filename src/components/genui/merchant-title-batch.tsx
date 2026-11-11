"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { ConfirmDialogButton } from "@/components/confirm-dialog-button";
import { StatusBadge } from "@/components/status-badge";
import {
  approveMerchantTitleBatch,
  getMerchantTitleBatch,
  revertMerchantTitleBatch,
} from "@/app/(app)/t/[team]/merchant-title-actions";
import type { TitleBatchView } from "@/lib/integrations/merchant_center/titles";

/**
 * The card for a merchantProposeTitles call: the batch as the database has it
 * now (not as the tool returned it, which goes stale once approved), with the
 * only buttons that send titles to Google.
 */
export function MerchantTitleBatchCard({ batchId }: { batchId: string }) {
  const [batch, setBatch] = useState<TitleBatchView | null>(null);
  const [canApprove, setCanApprove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const approveForm = useId();
  const revertForm = useId();

  useEffect(() => {
    let live = true;
    getMerchantTitleBatch(batchId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setBatch(r.batch);
        setCanApprove(r.canApprove);
      } else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [batchId]);

  function run(action: typeof approveMerchantTitleBatch) {
    setError(null);
    start(async () => {
      const r = await action(batchId);
      if (r.ok) setBatch(r.batch);
      else {
        setError(r.error);
        const fresh = await getMerchantTitleBatch(batchId);
        if (fresh.ok) setBatch(fresh.batch);
      }
    });
  }

  if (!batch) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3.5 py-2.5 text-xs text-zinc-500">
        {error ?? "Loading title batch…"}
      </div>
    );
  }

  const n = batch.changes.length;
  return (
    <div className="animate-enter space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-800">
            Google Shopping titles · {batch.accountLabel} · {n} product{n === 1 ? "" : "s"}
          </p>
          {batch.note && <p className="mt-0.5 text-xs text-zinc-500">{batch.note}</p>}
        </div>
        <StatusBadge status={batch.status} />
      </div>

      {batch.live && batch.status === "pending" && (
        <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
          Live account: these titles will show in Shopping ads and free listings within about 30 minutes.
        </p>
      )}

      <div className="max-h-96 overflow-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-zinc-50 text-zinc-500">
            <tr>
              <th className="px-2.5 py-1.5 font-medium">Offer</th>
              <th className="px-2.5 py-1.5 font-medium">Current title</th>
              <th className="px-2.5 py-1.5 font-medium">New title</th>
              <th className="px-2.5 py-1.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {batch.changes.map((c) => (
              <tr key={c.offerId} className="align-top">
                <td className="px-2.5 py-1.5 tabular-nums text-zinc-500">{c.offerId}</td>
                <td className="px-2.5 py-1.5 text-zinc-500">{c.oldTitle}</td>
                <td className="px-2.5 py-1.5 text-zinc-900">
                  {c.newTitle}
                  <span className="ml-1 text-zinc-400">({c.newTitle.length})</span>
                </td>
                <td className="px-2.5 py-1.5">
                  <StatusBadge status={c.status} />
                  {c.errorMessage && <p className="mt-1 text-red-600">{c.errorMessage}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {batch.errorMessage && <p className="text-xs text-red-600">{batch.errorMessage}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      {canApprove && batch.status === "pending" && (
        <form id={approveForm} action={() => run(approveMerchantTitleBatch)}>
          <ConfirmDialogButton
            formId={approveForm}
            label={pending ? "Sending…" : `Approve ${n} title${n === 1 ? "" : "s"}`}
            title="Send these titles to Google?"
            body={`${n} product title${n === 1 ? "" : "s"} on ${batch.accountLabel} will be overridden in Google Merchant Center. Everything else still comes from the feed, and you can revert from this card.`}
            confirmLabel="Approve and send"
          />
        </form>
      )}
      {canApprove && (batch.status === "applied" || batch.status === "partial") && (
        <form id={revertForm} action={() => run(revertMerchantTitleBatch)}>
          <ConfirmDialogButton
            formId={revertForm}
            label={pending ? "Reverting…" : "Revert"}
            title="Revert these titles?"
            body={`Google goes back to the feed's titles for these ${n} product${n === 1 ? "" : "s"} within about 30 minutes.`}
            confirmLabel="Revert"
            tone="danger"
          />
        </form>
      )}
      {!canApprove && batch.status === "pending" && (
        <p className="text-xs text-zinc-500">Waiting for an admin to approve.</p>
      )}
    </div>
  );
}
