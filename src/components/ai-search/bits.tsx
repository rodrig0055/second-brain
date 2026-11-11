import Link from "next/link";
import { ToneTag } from "@/components/status-badge";

export { Card, inputClass, labelClass } from "@/components/partners/bits";

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`;
}

/** Percentage-point change; nothing when either side is missing. */
export function Delta({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || before === null) return null;
  const pts = Math.round((now - before) * 100);
  if (pts === 0) return <span className="text-xs text-zinc-400">±0 pts</span>;
  return (
    <span className={`text-xs ${pts > 0 ? "text-emerald-700" : "text-red-700"}`}>
      {pts > 0 ? "+" : ""}
      {pts} pts
    </span>
  );
}

export function Tile({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: React.ReactNode;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3.5 shadow-card">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-900">{value}</span>
        {delta}
      </p>
      <p className="mt-1 text-[0.6875rem] leading-4 text-zinc-400">{hint}</p>
    </div>
  );
}

export function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`whitespace-nowrap border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-zinc-500 ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

export const td = "border-b border-zinc-100 px-3 py-2 align-top";
export const tdNum = `${td} text-right tabular-nums`;

export function Chip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[0.8rem] ${
        active
          ? "border-zinc-900 bg-zinc-900 text-zinc-50"
          : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
      }`}
    >
      {label}
    </Link>
  );
}

/** One assistant's latest answer to a prompt, as a compact cell. */
export function RunCell({
  run,
}: {
  run: { appeared: boolean; recommended: boolean; cited: boolean; position: number | null; error: string | null; runOn: string } | undefined;
}) {
  if (!run) return <span className="text-xs text-zinc-300">not run</span>;
  if (run.error) return <span className="text-xs text-red-600" title={run.error}>failed</span>;
  if (!run.appeared) return <span className="text-xs text-zinc-400">absent</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-xs">
      <ToneTag tone={run.recommended ? "success" : "neutral"} label={`${run.recommended ? "recommended" : "named"}${run.position ? ` #${run.position}` : ""}`} />
      {run.cited && <ToneTag tone="scheduled" label="linked" />}
    </span>
  );
}
