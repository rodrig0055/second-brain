"use client";

import { CircleAlert, CircleCheck, ChevronDown } from "lucide-react";
import type { FactCheckResult } from "@/lib/review/fact-check";

type Data = Partial<Omit<FactCheckResult, "status">> & { status: FactCheckResult["status"] | "running" };

/**
 * The post-answer fact check (api/chat): which claims in a skill answer the
 * turn's own tool results support, and which they do not.
 */
export function FactCheckCard({ data }: { data: Data }) {
  if (data.status === "running") {
    return <p className="u-shimmer w-fit text-xs font-medium">Fact-checking this answer…</p>;
  }
  if (data.status !== "done") {
    return (
      <p className="flex items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
        <CircleAlert className="mt-px size-3.5 shrink-0" />
        <span>
          <span className="font-medium">Not fact-checked.</span> {data.reason}
        </span>
      </p>
    );
  }

  const checks = data.checks ?? [];
  const problems = checks.filter((c) => c.status !== "supported");
  const supported = checks.filter((c) => c.status === "supported");

  if (problems.length === 0) {
    return (
      <details className="group rounded-xl border border-emerald-200 bg-emerald-50/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2 text-xs text-emerald-800 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-1.5">
            <CircleCheck className="size-3.5" />
            Fact check: {checks.length} claim{checks.length === 1 ? "" : "s"} checked against this answer&apos;s data, all supported.
          </span>
          <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <ul className="space-y-1 px-3.5 pb-3 text-xs text-zinc-600">
          {supported.map((c, i) => (
            <li key={i}>
              {c.claim} <span className="text-zinc-400">({c.evidence})</span>
            </li>
          ))}
        </ul>
      </details>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
        <CircleAlert className="size-3.5" />
        Fact check: {problems.length} of {checks.length} claim{checks.length === 1 ? "" : "s"} not backed by this answer&apos;s data. Fix before using.
      </p>
      <ul className="space-y-2">
        {problems.map((c, i) => (
          <li key={i} className="rounded-lg bg-white/70 px-3 py-2 text-xs">
            <p className="text-zinc-900">
              <span
                className={
                  c.status === "contradicted"
                    ? "mr-1.5 rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700"
                    : "mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800"
                }
              >
                {c.status === "contradicted" ? "Wrong" : "Unsupported"}
              </span>
              {c.claim}
            </p>
            <p className="mt-1 text-zinc-500">{c.evidence}</p>
            {c.fix && <p className="mt-1 text-zinc-700">Fix: {c.fix}</p>}
          </li>
        ))}
      </ul>
      {supported.length > 0 && (
        <p className="text-xs text-amber-800/80">{supported.length} other claim{supported.length === 1 ? "" : "s"} checked and supported.</p>
      )}
    </div>
  );
}
