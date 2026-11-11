import Link from "next/link";
import {
  Mail,
  AlertTriangle,
  Blocks,
  CalendarRange,
  HelpCircle,
  LayoutTemplate,
} from "lucide-react";
import { ActionSheet, SheetSubmitButton } from "@/components/ui/action-sheet";
import { Button } from "@astryxdesign/core/Button";
import { MODEL_OPTIONS } from "@/lib/models";
import { PLANNER_MODEL } from "@/lib/newsletter/defaults";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireNewsletterTeam, campaignPath } from "@/lib/newsletter/access";
import {
  listCampaigns,
  newsletterBrands,
  STATUS_LABEL,
} from "@/lib/newsletter/store";
import { TEMPLATES } from "@/lib/newsletter/templates";
import { StatusBadge } from "@/components/status-badge";
import { brandTone } from "@/lib/newsletter/brand-tone";
import { Calendar, type CalendarEntry } from "./calendar";
import { createFromBrief, createFromTemplate, planTheWeek } from "./actions";

export const dynamic = "force-dynamic";

function shortDate(iso: string): string {
  if (!iso) return "not set";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-SG", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Brand as a chip, not grey small print: it is the first thing to check on a row.
 * Colour comes from the shared tone table, keyed on slug, so the chip and the
 * calendar can never disagree about what colour a brand is.
 */
function BrandChip({ name, slug }: { name: string; slug: string }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${brandTone(slug).chip}`}
    >
      {name}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  // A newsletter draft is the normal resting state, not a call to act: "Needs hero art" is.
  return (
    <StatusBadge status={status} label={STATUS_LABEL[status]} tone={status === "draft" ? "neutral" : undefined} />
  );
}

export default async function NewsletterPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ m?: string }>;
}) {
  const { team: teamSlug } = await params;
  const { m } = await searchParams;
  const { team } = await requireNewsletterTeam(teamSlug);

  const rows = await listCampaigns(team.id);
  const brands = await newsletterBrands();
  const plannerModels = MODEL_OPTIONS.filter((o) => o.id !== PLANNER_MODEL);
  plannerModels.unshift(...MODEL_OPTIONS.filter((o) => o.id === PLANNER_MODEL));

  const entries: CalendarEntry[] = rows.map((r) => ({
    id: r.id,
    sendDate: r.sendDate,
    subject: r.subject,
    status: r.status,
    brandName: r.brandName,
    brandSlug: r.brandSlug,
    errors: r.validation?.errors ?? 0,
  }));

  const base = `/t/${teamSlug}/newsletter`;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="Campaigns"
        description="Plan the week, draft the sends, and hand the approved ones to SendPulse."
        action={
          <>
            <Button href={`${base}/blocks`} label="Blocks" icon={<Blocks size={16} />} />
            <ActionSheet
              label="Plan the week"
              title="Plan the week"
              description="Proposes one draft per send day from the framework, the calendar and what has been getting clicked. Dates that already have a campaign are left alone."
              variant="secondary"
              closeOn="done"
              width="max-w-2xl"
              icon={<CalendarRange className="size-4" />}
            >
              <form action={planTheWeek} className="space-y-3">
                <input type="hidden" name="teamSlug" value={teamSlug} />
                <div>
                  <label
                    htmlFor="pl-brand"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Brand
                  </label>
                  <select
                    id="pl-brand"
                    name="brandId"
                    required
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                    defaultValue={
                      brands.find((b) => b.slug === "bloomly-sg")?.id ?? ""
                    }
                  >
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="pl-week"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Week beginning
                  </label>
                  <input
                    id="pl-week"
                    name="weekStart"
                    type="date"
                    required
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="pl-model"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Model
                  </label>
                  {/* The recommended model is listed FIRST rather than relying on
                defaultValue: a server-rendered <select> here does not emit a
                `selected` attribute, so the browser falls back to the first
                option. Ordering makes the right default the default. */}
                  <select
                    id="pl-model"
                    name="model"
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                    defaultValue={PLANNER_MODEL}
                  >
                    {plannerModels.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id === PLANNER_MODEL
                          ? `${m.label} — recommended`
                          : m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <SheetSubmitButton
                  width="100%"
                  pendingLabel="Proposing…"
                >
                  Propose drafts
                </SheetSubmitButton>
              </form>
            </ActionSheet>
            <ActionSheet
              label="From a template"
              title="Start from a template"
              description="The shape of a whole email, arriving with real copy and a filled product grid. Everything stays editable, including each block's design."
              variant="secondary"
              closeOn="done"
              width="max-w-2xl"
              icon={<LayoutTemplate className="size-4" />}
            >
              <form action={createFromTemplate} className="space-y-3">
                <input type="hidden" name="teamSlug" value={teamSlug} />
                <div>
                  <label
                    htmlFor="tpl-brand"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Brand
                  </label>
                  <select
                    id="tpl-brand"
                    name="brandId"
                    required
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                    defaultValue={
                      brands.find((b) => b.slug === "bloomly-sg")?.id ?? ""
                    }
                  >
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="tpl-date"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Send date
                  </label>
                  <input
                    id="tpl-date"
                    name="sendDate"
                    type="date"
                    required
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="tpl-id"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Template
                  </label>
                  <select
                    id="tpl-id"
                    name="templateId"
                    required
                    defaultValue={TEMPLATES[0].id}
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  >
                    {TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <ul className="space-y-1 rounded-md bg-zinc-50 px-3 py-2 text-[0.6875rem] leading-relaxed text-zinc-600">
                  {TEMPLATES.map((t) => (
                    <li key={t.id}>
                      <b className="text-zinc-800">{t.label}</b>: {t.useWhen}
                    </li>
                  ))}
                </ul>
                <p className="text-[0.6875rem] leading-relaxed text-zinc-500">
                  The template sets the shape. Which engagement and product
                  blocks go in it comes from the content framework for that
                  brand and weekday, and the grids fill from the live feed.
                </p>
                <SheetSubmitButton
                  width="100%"
                  pendingLabel="Creating…"
                >
                  Create from template
                </SheetSubmitButton>
              </form>
            </ActionSheet>
            <ActionSheet
              label="New from a brief"
              title="New from a brief"
              description="Paste it exactly as written. Section rules, product names and the bracketed CTA are all understood."
              variant="primary"
              closeOn="done"
              width="max-w-2xl"
            >
              <form action={createFromBrief} className="space-y-3">
                <input type="hidden" name="teamSlug" value={teamSlug} />
                <div>
                  <label
                    htmlFor="nl-brand"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Brand
                  </label>
                  <select
                    id="nl-brand"
                    name="brandId"
                    required
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                    defaultValue={
                      brands.find((b) => b.slug === "bloomly-sg")?.id ?? ""
                    }
                  >
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="nl-date"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Send date
                  </label>
                  <input
                    id="nl-date"
                    name="sendDate"
                    type="date"
                    required
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="nl-subject"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Subject line
                  </label>
                  <input
                    id="nl-subject"
                    name="subject"
                    type="text"
                    placeholder="Optional, can be set later"
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="nl-brief"
                    className="block text-xs font-medium text-zinc-700"
                  >
                    Brief
                  </label>
                  <textarea
                    id="nl-brief"
                    name="brief"
                    rows={12}
                    required
                    placeholder={
                      "9.9 Mega Sale\nLast Day to Make It Special.\n9-11 September\n\n────────────\n\nLast Call for Big Savings.\n\nTrue Love (99 Red Roses)\nLove Blossom\n\n[ SHOP THE 9.9 ]"
                    }
                    className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 font-mono text-xs"
                  />
                </div>
                <SheetSubmitButton
                  width="100%" variant="primary"
                  pendingLabel="Creating…"
                >
                  Create campaign
                </SheetSubmitButton>
              </form>
            </ActionSheet>
          </>
        }
      />

      <details
        className="mt-6 rounded-lg border border-zinc-200 bg-white open:shadow-sm"
        open={rows.length === 0}
      >
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-zinc-900">
          <HelpCircle className="size-4 text-zinc-500" /> How this works
        </summary>
        <ol className="grid gap-x-8 gap-y-3 border-t border-zinc-100 px-5 py-4 text-sm text-zinc-700 sm:grid-cols-2">
          <li className="flex gap-3">
            <b className="w-5 shrink-0 tabular-nums text-zinc-400">1</b>
            <span>
              <b>Start a campaign</b>: let the brain propose the week from the
              framework and what has been getting clicked, start from a
              template, or paste the brief exactly as written.
            </span>
          </li>
          <li className="flex gap-3">
            <b className="w-5 shrink-0 tabular-nums text-zinc-400">2</b>
            <span>
              <b>Edit</b>: click any text in the preview to change it, or use
              the block list to reorder, add, delete, and swap products by name
              or URL. Every product resolves to a live price and stock.
            </span>
          </li>
          <li className="flex gap-3">
            <b className="w-5 shrink-0 tabular-nums text-zinc-400">3</b>
            <span>
              <b>Clear the checks</b>: a red item blocks approval, such as a
              product not in the catalog or a grid that leaves a lone tile.
              Amber items are for you to confirm.
            </span>
          </li>
          <li className="flex gap-3">
            <b className="w-5 shrink-0 tabular-nums text-zinc-400">4</b>
            <span>
              <b>Add the hero</b>: generate one with GPT Image, or paste a URL
              from the designer. Copy stays live text on top of it.
            </span>
          </li>
          <li className="flex gap-3">
            <b className="w-5 shrink-0 tabular-nums text-zinc-400">5</b>
            <span>
              <b>Approve</b>, then <b>Send to SendPulse</b>. That stores the
              email as a template; it does not send. A person picks the list and
              presses send in SendPulse.
            </span>
          </li>
          <li className="flex gap-3">
            <b className="w-5 shrink-0 tabular-nums text-zinc-400">6</b>
            <span>
              <b>Results</b> live in the Dashboards tab, per link for every
              send. They feed the next week&apos;s proposals.
            </span>
          </li>
        </ol>
      </details>

      <div className="mt-6 space-y-6">
        <Calendar entries={entries} month={m} basePath={base} />

        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900">
            All campaigns
          </h2>
          {rows.length === 0 ? (
            <EmptyState
              icon={<Mail className="size-5" />}
              title="No campaigns yet"
              description="Plan the week, start from a template, or paste a brief, from the buttons at the top."
            />
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link
                    href={campaignPath(r.id)}
                    className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50"
                  >
                    <div className="w-28 shrink-0 text-sm font-medium tabular-nums text-zinc-900">
                      {shortDate(r.sendDate)}
                    </div>
                    <BrandChip name={r.brandName} slug={r.brandSlug} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-zinc-900">
                        {r.subject || (
                          <span className="text-zinc-400">No subject yet</span>
                        )}
                      </div>
                    </div>
                    {r.validation && r.validation.errors > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-red-600">
                        <AlertTriangle className="size-3.5" />
                        {r.validation.errors}
                      </span>
                    )}
                    <StatusPill status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
