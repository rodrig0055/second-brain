"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Button } from "@astryxdesign/core/Button";
import { ConfirmDialogButton } from "@/components/confirm-dialog-button";
import { StatusBadge } from "@/components/status-badge";
import { applyCmsChange, getCmsChange, rejectCmsChange } from "@/app/(app)/t/[team]/cms-actions";
import type { CmsRequestView } from "@/lib/integrations/cms/requests";

/** Pretty JSON when the text is JSON, else the text itself. */
function pretty(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * The card for a proposed CMS change: the change as the database has it now
 * (not as the tool returned it, which goes stale once applied), with the only
 * buttons that send it to the storefront.
 */
export function CmsChangeCard({ requestId }: { requestId: string }) {
  const [req, setReq] = useState<CmsRequestView | null>(null);
  const [canApply, setCanApply] = useState(false);
  const [canReject, setCanReject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const applyForm = useId();

  useEffect(() => {
    let live = true;
    getCmsChange(requestId).then((r) => {
      if (!live) return;
      if (r.ok) {
        setReq(r.request);
        setCanApply(r.canApply);
        setCanReject(r.canReject);
      } else setError(r.error);
    });
    return () => {
      live = false;
    };
  }, [requestId]);

  function run(action: typeof applyCmsChange) {
    setError(null);
    start(async () => {
      const r = await action(requestId);
      if (r.ok) setReq(r.request);
      else {
        setError(r.error);
        const fresh = await getCmsChange(requestId);
        if (fresh.ok) setReq(fresh.request);
      }
    });
  }

  if (!req) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3.5 py-2.5 text-xs text-zinc-500">
        {error ?? "Loading CMS change…"}
      </div>
    );
  }

  const publish = req.kind === "publish";
  const where = `${req.host.replace(/^https:\/\//, "")} · ${req.tenant}`;
  return (
    <div className="animate-enter space-y-3 rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-zinc-800">{req.summary}</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            CMS · {where}
            {req.createdByName ? ` · asked by ${req.createdByName}` : ""}
          </p>
          {req.note && <p className="mt-1 text-xs text-zinc-600">{req.note}</p>}
        </div>
        <StatusBadge status={req.status} />
      </div>

      {req.status === "pending" &&
        (req.live ? (
          <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
            {publish
              ? "Live storefront: customers see this change as soon as it is applied."
              : "Live CMS: this changes real catalog data. New products, banners and flash deals or prices stay unpublished until published."}
          </p>
        ) : (
          <p className="rounded-md bg-sky-50 px-2.5 py-1.5 text-xs text-sky-800 ring-1 ring-inset ring-sky-200">
            Test storefront: nothing here reaches customers.
          </p>
        ))}

      <details className="rounded-lg border border-zinc-200 bg-white">
        <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-zinc-500">
          What will be sent ({req.tool})
        </summary>
        <pre className="max-h-80 overflow-auto px-2.5 pb-2 text-[0.6875rem] leading-relaxed text-zinc-700">
          {JSON.stringify(req.args, null, 2)}
        </pre>
      </details>

      {req.result && (
        <details className="rounded-lg border border-zinc-200 bg-white" open={req.status === "applied"}>
          <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-zinc-500">What the CMS answered</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap px-2.5 pb-2 text-[0.6875rem] leading-relaxed text-zinc-700">
            {pretty(req.result)}
          </pre>
        </details>
      )}

      {req.errorMessage && req.errorMessage !== req.result && (
        <p className="text-xs text-red-600">{req.errorMessage}</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {req.decidedByName && req.status !== "pending" && (
        <p className="text-xs text-zinc-500">
          {req.status === "rejected" ? "Rejected" : "Applied"} by {req.decidedByName}
          {req.decidedAt ? ` · ${new Date(req.decidedAt).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })}` : ""}
        </p>
      )}

      {req.status === "pending" && (
        <div className="flex flex-wrap items-center gap-2">
          {canApply && (
            <form id={applyForm} action={() => run(applyCmsChange)}>
              <ConfirmDialogButton
                formId={applyForm}
                label={pending ? "Applying…" : publish ? "Apply publishing change" : "Apply to CMS"}
                title={publish ? "Change what customers can see?" : "Send this change to the CMS?"}
                body={`${req.summary} on ${where}.${req.live ? " This is the live CMS." : " This is a test storefront."}`}
                confirmLabel="Apply"
                tone={publish && req.live ? "danger" : "default"}
              />
            </form>
          )}
          {canReject && (
            <Button
              label="Reject"
              size="sm"
              isDisabled={pending}
              onClick={() => run(rejectCmsChange)}
            />
          )}
          {!canApply && publish && <p className="text-xs text-zinc-500">Waiting for an admin to apply.</p>}
        </div>
      )}
    </div>
  );
}
