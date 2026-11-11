import { Suspense } from "react";
import Link from "next/link";
import { Handshake } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ActionSheet } from "@/components/ui/action-sheet";
import { QueryFilter } from "@/components/ui/filter-pill";
import {
  ContactLinks,
  DueBadge,
  PartnerStatusBadge,
  KindField,
  ago,
  inputClass,
  labelClass,
} from "@/components/partners/bits";
import { loadPartnerOwners, loadPartners, today, type PartnerRow } from "@/lib/partners/data";
import { partnerPath, requirePartnershipsTeam } from "@/lib/partners/gate";
import { LADDER_WAIT_DAYS } from "@/lib/partners/ladder";
import {
  CHANNEL_LABELS,
  PARTNER_STATUSES,
  STATUS_LABELS,
  kindLabel,
  kindOptions,
  isStatus,
} from "@/lib/partners/model";
import { createPartner } from "./actions";

type Filters = { status?: string; kind?: string; owner?: string };

/** Filters are links, not state, so the whole page stays a server component. */
function chipHref(current: Filters, patch: Filters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...patch })) if (v) params.set(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

function Chip({ href, label, active, count, tone }: { href: string; label: string; active: boolean; count: number; tone?: "warn" }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.8rem] ${
        active
          ? "border-zinc-900 bg-zinc-900 text-zinc-50"
          : tone === "warn"
            ? "border-red-200 bg-red-50 text-red-700 hover:border-red-300"
            : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
      }`}
    >
      {label}
      <span className={active ? "text-zinc-400" : "opacity-60"}>{count}</span>
    </Link>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`sticky top-0 z-10 whitespace-nowrap border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-zinc-500 ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

const td = "border-b border-zinc-100 px-3 py-2.5 align-top";

const isDue = (p: PartnerRow) => p.urgency === "overdue" || p.urgency === "today";

export default async function PartnersPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Filters>;
}) {
  const { team: teamSlug } = await params;
  const { team, brand, user } = await requirePartnershipsTeam(teamSlug);
  const filters = await searchParams;
  const now = today();

  const [all, owners] = await Promise.all([loadPartners(brand.id), loadPartnerOwners()]);

  const statusFilter = filters.status === "due" || isStatus(filters.status) ? filters.status : "";
  // Types come from the partners themselves, so one the team added shows up
  // in the picker and the filter as soon as a partner uses it.
  const kinds = kindOptions(all.map((p) => p.kind));
  const kindFilter = kinds.some((k) => k.value === filters.kind) ? filters.kind! : "";
  const ownerFilter = filters.owner ?? "";

  // Kind and owner narrow the list first, so the status counts describe what
  // is on screen rather than the whole tracker.
  const scoped = all.filter(
    (p) =>
      (!kindFilter || p.kind === kindFilter) &&
      (!ownerFilter || (ownerFilter === "none" ? !p.ownerId : p.ownerId === ownerFilter)),
  );
  const visible = scoped.filter((p) =>
    !statusFilter ? true : statusFilter === "due" ? isDue(p) : p.status === statusFilter,
  );
  const dueCount = scoped.filter(isDue).length;

  const addForm = (
    <ActionSheet label="Add partner" title="Add a partner" description="A platform, school, company or any other type. Add more contacts on its page.">
      <form action={createPartner} className="grid gap-3">
        <input type="hidden" name="teamSlug" value={team.slug} />
        <label className={labelClass}>
          Name
          <input name="name" required className={inputClass} placeholder="Dive Deals" />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <KindField options={kinds} defaultValue="platform" />
          <label className={labelClass}>
            Status
            <select name="status" defaultValue="prospect" className={inputClass}>
              {PARTNER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Owner
            <select name="ownerId" defaultValue={user.id} className={inputClass}>
              <option value="">Unassigned</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <fieldset className="grid gap-3 rounded-lg border border-zinc-200 p-3 sm:grid-cols-2">
          <legend className="px-1 text-xs font-medium text-zinc-700">Main contact (POC)</legend>
          <label className={labelClass}>
            Name
            <input name="contactName" className={inputClass} />
          </label>
          <label className={labelClass}>
            Role
            <input name="contactRole" className={inputClass} placeholder="Partnerships lead" />
          </label>
          <label className={labelClass}>
            Email
            <input name="contactEmail" type="email" className={inputClass} />
          </label>
          <label className={labelClass}>
            Phone
            <input name="contactPhone" type="tel" className={inputClass} placeholder="+65 ..." />
          </label>
        </fieldset>
        <label className={labelClass}>
          Voucher codes
          <input name="codes" className={inputClass} placeholder="DIVEDEALS20, KRIS*PLUS*" />
          <span className="text-[0.6875rem] text-zinc-400">
            Orders using these codes count as this partner&apos;s sales. * matches anything. Leave empty until the code exists.
          </span>
        </label>
        <label className={labelClass}>
          Website
          <input name="website" type="url" className={inputClass} placeholder="https://" />
        </label>
        <Button type="submit" label="Add partner" variant="primary" size="sm" className="justify-self-start" />
      </form>
    </ActionSheet>
  );

  const counts = Object.fromEntries(PARTNER_STATUSES.map((s) => [s, scoped.filter((p) => p.status === s).length]));

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="Partners"
        description={`Bloomly SG partnerships. Follow-ups run email, a follow-up email ${LADDER_WAIT_DAYS.followUp} working days later, then a call ${LADDER_WAIT_DAYS.call} days after that. Log every contact on the partner's page and the next step works itself out.`}
        action={addForm}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <Chip href={chipHref(filters, { status: "" })} label="All" count={scoped.length} active={!statusFilter} />
          {dueCount > 0 && (
            <Chip href={chipHref(filters, { status: "due" })} label="Due now" count={dueCount} active={statusFilter === "due"} tone="warn" />
          )}
          {PARTNER_STATUSES.map((s) => (
            <Chip
              key={s}
              href={chipHref(filters, { status: s })}
              label={STATUS_LABELS[s]}
              count={counts[s]}
              active={statusFilter === s}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Suspense fallback={null}>
            <QueryFilter
              name="kind"
              allLabel="All types"
              options={kinds}
            />
            <QueryFilter
              name="owner"
              allLabel="Any owner"
              options={[{ value: "none", label: "Unassigned" }, ...owners.map((o) => ({ value: o.id, label: o.label }))]}
            />
          </Suspense>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<Handshake className="size-4" />}
            title={all.length === 0 ? "No partners yet" : "Nothing matches these filters"}
            description={
              all.length === 0
                ? "Add the platforms, schools and companies you are talking to. Each one gets its contacts, a contact log and its sales."
                : "Clear a filter to see the rest."
            }
            action={
              all.length > 0 ? (
                <Button href="?" label="Clear filters" variant="primary" size="sm" />
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-4 overflow-auto rounded-xl border border-zinc-200 bg-white shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <Th>Partner</Th>
                <Th>Status</Th>
                <Th>Main contact</Th>
                <Th>Last contact</Th>
                <Th>Next step</Th>
                <Th>Owner</Th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.id} className={`hover:bg-zinc-50 ${p.status === "declined" ? "opacity-60" : ""}`}>
                  <td className={td}>
                    <Link href={partnerPath(p.id)} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                      {p.name}
                    </Link>
                    <span className="block text-xs text-zinc-400">{kindLabel(p.kind)}</span>
                  </td>
                  <td className={td}>
                    <PartnerStatusBadge status={p.status} />
                  </td>
                  <td className={`${td} max-w-64`}>
                    {p.primary ? (
                      <>
                        <span className="block text-zinc-800">
                          {p.primary.name || "—"}
                          {p.primary.role && <span className="text-xs text-zinc-400"> · {p.primary.role}</span>}
                        </span>
                        <ContactLinks email={p.primary.email} phone={p.primary.phone} />
                        {p.contactCount > 1 && <span className="text-[0.6875rem] text-zinc-400">+{p.contactCount - 1} more</span>}
                      </>
                    ) : (
                      <span className="text-xs text-zinc-400">No contact yet</span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>
                    {p.lastTouch ? (
                      <>
                        <span className="block text-zinc-800">{ago(p.lastTouch.on, now)}</span>
                        <span className="block text-xs text-zinc-500">
                          {CHANNEL_LABELS[p.lastTouch.channel]}
                          {p.lastTouch.contactName && ` · ${p.lastTouch.contactName}`}
                        </span>
                        {p.lastTouch.outcome === "replied" && <span className="text-[0.6875rem] text-emerald-600">They responded</span>}
                      </>
                    ) : (
                      <span className="text-xs text-zinc-400">Never</span>
                    )}
                  </td>
                  <td className={`${td} min-w-48`}>
                    {p.next ? (
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-zinc-800">{p.next.action}</span>
                        <DueBadge due={p.next.due} urgency={p.urgency} today={now} />
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-400">—</span>
                    )}
                  </td>
                  <td className={`${td} whitespace-nowrap text-zinc-500`}>{p.ownerName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
