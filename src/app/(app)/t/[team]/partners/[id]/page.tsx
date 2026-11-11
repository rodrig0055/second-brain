import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { PageHeader } from "@/components/page-header";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmailDraftPanel } from "@/components/partners/email-draft";
import {
  Card,
  ContactLinks,
  DueBadge,
  KindField,
  PartnerStatusBadge,
  ago,
  day,
  inputClass,
  labelClass,
} from "@/components/partners/bits";
import { formatMoney, formatNumber } from "@/lib/insights/format";
import { loadPartner, loadPartnerKinds, loadPartnerOwners, today } from "@/lib/partners/data";
import { defaultPurpose } from "@/lib/partners/email";
import { partnersPath, requirePartnershipsTeam, salesPath } from "@/lib/partners/gate";
import { LADDER_RUNGS } from "@/lib/partners/ladder";
import {
  CHANNEL_LABELS,
  CHANNELS,
  kindLabel,
  kindOptions,
  PARTNER_STATUSES,
  PARTNERS_CURRENCY,
  STATUS_HINTS,
  STATUS_LABELS,
} from "@/lib/partners/model";
import { figuresFor, loadPartnerSales } from "@/lib/partners/sales";
import {
  deleteContact,
  deletePartner,
  deleteTouch,
  logTouch,
  saveContact,
  setPartnerStatus,
  updatePartner,
} from "../actions";
import { ToneTag } from "@/components/status-badge";

/** Email, follow-up, call, call again: where this partner is on it. */
function Ladder({ rung }: { rung: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[0.6875rem]">
      {LADDER_RUNGS.map((r, i) => {
        const done = i < rung;
        const current = i === rung;
        return (
          <li key={r} className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ring-1 ring-inset ${
                done
                  ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                  : current
                    ? "bg-zinc-900 text-zinc-50 ring-zinc-900"
                    : "bg-white text-zinc-400 ring-zinc-200"
              }`}
            >
              {done && <Check className="size-3" />}
              {r}
            </span>
            {i < LADDER_RUNGS.length - 1 && <span className="text-zinc-300">→</span>}
          </li>
        );
      })}
    </ol>
  );
}

export default async function PartnerPage({ params }: { params: Promise<{ team: string; id: string }> }) {
  const { team: teamSlug, id } = await params;
  const { team, brand, user } = await requirePartnershipsTeam(teamSlug);
  const now = today();

  const [found, owners, used] = await Promise.all([loadPartner(brand.id, id), loadPartnerOwners(), loadPartnerKinds(brand.id)]);
  if (!found) notFound();
  const { partner: p, contacts, touches } = found;
  const sales = p.codes.length > 0 ? await loadPartnerSales(brand.id, [{ id: p.id, codes: p.codes }], now, "half", 6) : null;
  const matchedCodes = sales ? [...(sales.codesByPartner.get(p.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]) : [];

  const hidden = (
    <>
      <input type="hidden" name="teamSlug" value={team.slug} />
      <input type="hidden" name="partnerId" value={p.id} />
    </>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumbs={[{ label: "Partners", href: partnersPath() }]}
        eyebrow={kindLabel(p.kind)}
        title={p.name}
        description={
          <>
            {p.website && (
              <a href={p.website} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-zinc-900">
                {p.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            )}
            {p.website && " · "}
            {p.ownerName ? `Owner ${p.ownerName}` : "No owner"}
          </>
        }
        action={
          <form action={setPartnerStatus} className="flex items-center gap-2">
            {hidden}
            <PartnerStatusBadge status={p.status} />
            <select name="status" defaultValue={p.status} className={`${inputClass} w-auto py-1 text-xs`} aria-label="Change status">
              {PARTNER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}: {STATUS_HINTS[s]}
                </option>
              ))}
            </select>
            <Button type="submit" label="Set" size="sm" />
          </form>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <Card title="Next step" description={p.next ? undefined : "Nothing due. Live, paused and declined partners have no follow-ups unless you plan one."}>
            {p.next && (
              <div className="mb-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium text-zinc-900">{p.next.action}</span>
                  <DueBadge due={p.next.due} urgency={p.urgency} today={now} />
                </div>
                {p.next.rung !== null && p.next.rung < LADDER_RUNGS.length && <Ladder rung={p.next.rung} />}
                {p.primary && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span className="text-xs text-zinc-700">{p.primary.name || "Main contact"}</span>
                    <ContactLinks email={p.primary.email} phone={p.primary.phone} />
                  </div>
                )}
              </div>
            )}

            <div className="mb-3">
              <EmailDraftPanel
                teamSlug={team.slug}
                partnerId={p.id}
                contacts={contacts.filter((c) => c.email).map((c) => ({ id: c.id, name: c.name, email: c.email }))}
                defaultContactId={(p.primary?.email ? p.primary.id : contacts.find((c) => c.email)?.id) ?? ""}
                defaultPurpose={defaultPurpose(p)}
                account={user.email}
              />
            </div>

            <form action={logTouch} className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/60 p-3">
              {hidden}
              <p className="text-xs font-medium text-zinc-700">Log a contact</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className={labelClass}>
                  How
                  <select name="channel" defaultValue={p.next?.rung === 2 || p.next?.rung === 3 ? "call" : "email"} className={inputClass}>
                    {CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_LABELS[c]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  With
                  <select name="contactId" defaultValue={p.primary?.id ?? ""} className={inputClass}>
                    <option value="">Not a listed contact</option>
                    {contacts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name || c.email || c.phone}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  When
                  <input type="date" name="on" defaultValue={now} max={now} className={inputClass} />
                </label>
              </div>
              <fieldset className="flex flex-wrap gap-4 text-sm text-zinc-700">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="outcome" value="sent" defaultChecked />
                  We reached out (no answer yet)
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="outcome" value="replied" />
                  They responded / we spoke
                </label>
              </fieldset>
              <textarea name="note" rows={2} placeholder="What was said or sent" className={inputClass} />
              <Button type="submit" label="Log contact" variant="primary" size="sm" />
            </form>
          </Card>

          <Card title="Contact log" description={touches.length ? `${touches.length} logged, newest first.` : "Nothing logged yet."}>
            {touches.length > 0 && (
              <ul className="divide-y divide-zinc-100">
                {touches.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-800">
                        <span className="font-medium">{CHANNEL_LABELS[t.channel]}</span>
                        {t.contactName && <span className="text-zinc-500"> with {t.contactName}</span>}
                        {t.outcome === "replied" ? (
                          <> <ToneTag tone="success" label="responded" /></>
                        ) : (
                          <> <ToneTag tone="muted" label="no answer yet" /></>
                        )}
                      </p>
                      {t.note && <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-600">{t.note}</p>}
                      <p className="mt-0.5 text-xs text-zinc-400">
                        {day(t.on)} ({ago(t.on, now)}){t.authorName && ` · logged by ${t.authorName}`}
                      </p>
                    </div>
                    {(user.role === "admin" || t.userId === user.id) && (
                      <form action={deleteTouch}>
                        {hidden}
                        <input type="hidden" name="touchId" value={t.id} />
                        <ConfirmSubmitButton
                          message="Remove this log entry?"
                          label="Remove log entry"
                          isIconOnly
                          icon={<Trash2 className="size-full" aria-hidden />}
                        />
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            title="Sales"
            description={
              sales
                ? "Orders that used this partner's codes, by half-month. From your commerce database."
                : "Add this partner's voucher code under Details to count its sales here."
            }
            action={
              <Link href={salesPath()} className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline">
                All partners
              </Link>
            }
          >
            {sales && (
              <>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-zinc-500">
                        <th className="py-1.5 pr-3 font-semibold">Period</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">Orders</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">Revenue</th>
                        <th className="py-1.5 pr-3 text-right font-semibold">New customers</th>
                        <th className="py-1.5 text-right font-semibold">Voucher cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...sales.periods].reverse().map((period, i) => {
                        const f = figuresFor(sales, p.id, period.key);
                        return (
                          <tr key={period.key} className="border-t border-zinc-100 tabular-nums">
                            <td className="py-1.5 pr-3 text-zinc-700">
                              {period.label}
                              {i === 0 && <span className="ml-1 text-xs text-zinc-400">so far</span>}
                            </td>
                            <td className="py-1.5 pr-3 text-right font-medium text-zinc-900">{formatNumber(f.orders)}</td>
                            <td className="py-1.5 pr-3 text-right text-zinc-700">{formatMoney(f.revenue, PARTNERS_CURRENCY)}</td>
                            <td className="py-1.5 pr-3 text-right text-zinc-700">{formatNumber(f.newCustomers)}</td>
                            <td className="py-1.5 text-right text-zinc-700">{formatMoney(f.voucherCost, PARTNERS_CURRENCY)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-zinc-500">
                  {matchedCodes.length === 0
                    ? `No orders matched ${p.codes.join(", ")} in these three months.`
                    : `Codes used: ${matchedCodes
                        .slice(0, 8)
                        .map(([c, n]) => `${c} (${n})`)
                        .join(", ")}${matchedCodes.length > 8 ? ` and ${matchedCodes.length - 8} more` : ""}.`}
                </p>
              </>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Contacts" description="The primary one shows on the list.">
            <ul className="space-y-3">
              {contacts.map((c) => (
                <li key={c.id} className="rounded-lg border border-zinc-200 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-zinc-800">
                        {c.name || "—"}
                        {c.isPrimary && (
                          <span className="ml-1.5 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[0.625rem] font-normal text-zinc-500">primary</span>
                        )}
                      </p>
                      {c.role && <p className="text-xs text-zinc-500">{c.role}</p>}
                      <ContactLinks email={c.email} phone={c.phone} />
                    </div>
                    <form action={deleteContact}>
                      {hidden}
                      <input type="hidden" name="contactId" value={c.id} />
                      <ConfirmSubmitButton
                        message={`Remove ${c.name || c.email || "this contact"}? Their log entries stay.`}
                        label="Remove contact"
                        isIconOnly
                        icon={<Trash2 className="size-full" aria-hidden />}
                      />
                    </form>
                  </div>
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-700">Edit</summary>
                    <ContactForm hidden={hidden} contact={c} />
                  </details>
                </li>
              ))}
            </ul>
            <details className="mt-3" open={contacts.length === 0}>
              <summary className="cursor-pointer text-xs font-medium text-zinc-700">Add a contact</summary>
              <ContactForm hidden={hidden} />
            </details>
          </Card>

          <Card title="Details">
            <form action={updatePartner} className="space-y-3">
              {hidden}
              <label className={labelClass}>
                Name
                <input name="name" defaultValue={p.name} required className={inputClass} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <KindField options={kindOptions(used)} defaultValue={p.kind} />
                <label className={labelClass}>
                  Status
                  <select name="status" defaultValue={p.status} className={inputClass}>
                    {PARTNER_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className={labelClass}>
                Owner
                <select name="ownerId" defaultValue={p.ownerId ?? ""} className={inputClass}>
                  <option value="">Unassigned</option>
                  {owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Voucher codes
                <input name="codes" defaultValue={p.codes.join(", ")} className={inputClass} placeholder="DIVEDEALS20, KRIS*PLUS*" />
                <span className="text-[0.6875rem] text-zinc-400">Comma separated. * matches anything.</span>
              </label>
              <label className={labelClass}>
                Planned follow-up
                <input type="date" name="followUpOn" defaultValue={p.followUpOn ?? ""} className={inputClass} />
                <span className="text-[0.6875rem] text-zinc-400">
                  When they asked you to come back. Replaces the usual next step until then.
                </span>
              </label>
              <label className={labelClass}>
                Website
                <input name="website" type="url" defaultValue={p.website} className={inputClass} />
              </label>
              <label className={labelClass}>
                Deal and notes
                <textarea
                  name="notes"
                  rows={4}
                  defaultValue={p.notes}
                  placeholder="20% off capped S$10, blast to members in Nov..."
                  className={inputClass}
                />
              </label>
              <Button type="submit" label="Save details" variant="primary" size="sm" />
            </form>
          </Card>

          {user.role === "admin" && (
            <form action={deletePartner} className="text-right">
              {hidden}
              <ConfirmSubmitButton
                message={`Delete ${p.name} with all its contacts and its log? This cannot be undone.`}
                label="Delete partner"
              />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactForm({
  hidden,
  contact,
}: {
  hidden: React.ReactNode;
  contact?: { id: string; name: string; role: string; email: string; phone: string; isPrimary: boolean };
}) {
  return (
    <form action={saveContact} className="mt-2 grid gap-2">
      {hidden}
      {contact && <input type="hidden" name="contactId" value={contact.id} />}
      <input name="name" defaultValue={contact?.name} placeholder="Name" className={inputClass} />
      <input name="role" defaultValue={contact?.role} placeholder="Role" className={inputClass} />
      <input name="email" type="email" defaultValue={contact?.email} placeholder="Email" className={inputClass} />
      <input name="phone" type="tel" defaultValue={contact?.phone} placeholder="Phone" className={inputClass} />
      {!contact?.isPrimary && (
        <label className="flex items-center gap-1.5 text-xs text-zinc-600">
          <input type="checkbox" name="isPrimary" />
          Make primary
        </label>
      )}
      <Button type="submit" label={contact ? "Save contact" : "Add contact"} size="sm" className="justify-self-start" />
    </form>
  );
}
