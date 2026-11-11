import { Mail, Phone } from "lucide-react";

import { StatusBadge, ToneTag } from "@/components/status-badge";
import type { Urgency } from "@/lib/partners/ladder";
import type { StatusTone } from "@/lib/status";
import { KIND_MAX, NEW_KIND, STATUS_LABELS, type PartnerStatus } from "@/lib/partners/model";

/** The partner's stage, coloured from the shared status map. */
export function PartnerStatusBadge({ status }: { status: PartnerStatus }) {
  return <StatusBadge status={status} label={STATUS_LABELS[status]} />;
}

const URGENCY_TONE: Record<Urgency, StatusTone> = {
  overdue: "danger",
  today: "attention",
  soon: "neutral",
  later: "neutral",
  none: "muted",
};

/** "Overdue 3d", "Due today", "Mon 27 Oct". */
export function DueBadge({ due, urgency, today }: { due: string | null; urgency: Urgency; today: string }) {
  if (!due) return null;
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
  const text = urgency === "overdue" ? `Overdue ${days}d` : urgency === "today" ? "Due today" : weekday(due);
  return <ToneTag tone={URGENCY_TONE[urgency]} label={text} />;
}

export function day(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function weekday(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "today", "yesterday", "5d ago", then the date. */
export function ago(ymd: string, today: string): string {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d ago`;
  return day(ymd);
}

/** Email and phone as links, so a click opens the mail app or the dialer. */
export function ContactLinks({ email, phone }: { email: string; phone: string }) {
  return (
    <>
      {email && (
        <a href={`mailto:${email}`} className="flex min-w-0 items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900">
          <Mail className="size-3 shrink-0" />
          <span className="truncate">{email}</span>
        </a>
      )}
      {phone && (
        <a
          href={`tel:${phone.replace(/[^\d+]/g, "")}`}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900"
        >
          <Phone className="size-3 shrink-0" />
          {phone}
        </a>
      )}
    </>
  );
}

export const inputClass =
  "u-transition w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none";
export const labelClass = "flex flex-col gap-1 text-xs text-zinc-600";

export function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-zinc-800">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
        </div>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * The Type picker. Choosing "New type..." reveals a name field, done in CSS
 * (:has on the selected option) so the forms stay server components.
 */
export function KindField({ options, defaultValue }: { options: { value: string; label: string }[]; defaultValue: string }) {
  return (
    <div className="group flex flex-col gap-1">
      <label className={labelClass}>
        Type
        <select name="kind" defaultValue={defaultValue} className={inputClass}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          <option value={NEW_KIND}>New type…</option>
        </select>
      </label>
      <input
        name="newKind"
        maxLength={KIND_MAX}
        aria-label="New type name"
        placeholder="Insurance, Bank, Health…"
        // The literal new-kind is NEW_KIND, spelled out so Tailwind can see the class.
        className={`${inputClass} hidden group-has-[option[value=new-kind]:checked]:block`}
      />
    </div>
  );
}
