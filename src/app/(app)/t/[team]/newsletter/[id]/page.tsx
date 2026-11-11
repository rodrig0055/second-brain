import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, HelpCircle,
  Bookmark, CalendarDays, Info, LayoutTemplate, Sparkles, Trash2,
} from "lucide-react";

import { requireNewsletterTeam, campaignsPath } from "@/lib/newsletter/access";
import { loadCampaign, STATUS_LABEL } from "@/lib/newsletter/store";
import { loadCatalog, resolveOne, type Catalog, type Resolved } from "@/lib/newsletter/catalog";
import { loadInventory } from "@/lib/newsletter/inventory";
import { validate } from "@/lib/newsletter/validate";
import { productNames } from "@/lib/newsletter/links";
import type { Block } from "@/lib/newsletter/campaign";
import { getBlockDef, defsByCategory, FIXED_KINDS } from "@/lib/newsletter/blocks";
import type { FieldDef } from "@/lib/newsletter/blocks/types";
import { TEMPLATES } from "@/lib/newsletter/templates";
import { frameworkFor } from "@/lib/newsletter/store";
import { WEEKDAY_NAME } from "@/lib/newsletter/framework";
import { HERO_MODEL, HERO_MODEL_FAST } from "@/lib/newsletter/defaults";
import {
  addBlock, addItem, addSuggested, applyTemplate, approveCampaign, deleteBlock,
  generateHeroAction, handOffCampaign, moveBlock, removeItem, removeProduct,
  saveAsTemplate, setProduct, setVariant, updateBlockField, updateItem, updateMeta,
} from "../actions";
import { PreviewBridge } from "./preview-bridge";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Read one property off a block without knowing which kind it is. */
function val(b: Block, name: string): string {
  const v = (b as unknown as Record<string, unknown>)[name];
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

function list(b: Block, prop: string): Record<string, string>[] {
  const v = (b as unknown as Record<string, unknown>)[prop];
  return Array.isArray(v) ? (v as Record<string, string>[]) : [];
}

function Hidden({ teamSlug, campaignId, index }: { teamSlug: string; campaignId: string; index?: number }) {
  return (
    <>
      <input type="hidden" name="teamSlug" value={teamSlug} />
      <input type="hidden" name="campaignId" value={campaignId} />
      {index !== undefined && <input type="hidden" name="blockIndex" value={index} />}
    </>
  );
}

const inputClass = "w-full rounded border border-zinc-200 px-2 py-1 text-sm";
const monoClass = "w-full rounded border border-zinc-200 px-2 py-1 font-mono text-xs";

/** One field of one block, saved on submit. Shape comes from the block's own declaration. */
function Field({
  teamSlug, campaignId, index, def, value,
}: {
  teamSlug: string; campaignId: string; index: number; def: FieldDef; value: string;
}) {
  const id = `b${index}-${def.name}`;
  const mono = def.kind === "url" || def.kind === "code";
  return (
    <form action={updateBlockField} className="contents">
      <Hidden teamSlug={teamSlug} campaignId={campaignId} index={index} />
      <input type="hidden" name="field" value={def.name} />
      <label htmlFor={id} className="pt-1.5 text-[0.6875rem] uppercase tracking-wide text-zinc-400" title={def.hint}>
        {def.label}
      </label>
      <div className="flex gap-1.5">
        {def.kind === "long" ? (
          <textarea id={id} name="value" defaultValue={value} rows={2} placeholder={def.hint} className={inputClass} />
        ) : (
          <input id={id} name="value" defaultValue={value} placeholder={def.hint} className={mono ? monoClass : inputClass} />
        )}
        <Button label="Save" type="submit" size="sm" className="shrink-0" />
      </div>
    </form>
  );
}

/**
 * The design picker.
 *
 * Each variant is its own submit button carrying `name="variant"`, so switching
 * design needs no client JavaScript and no separate Apply step.
 */
function VariantPicker({
  teamSlug, campaignId, index, current, variants,
}: {
  teamSlug: string; campaignId: string; index: number; current: string;
  variants: Array<{ id: string; label: string; blurb?: string }>;
}) {
  if (variants.length < 2) return null;
  return (
    <form action={setVariant} className="mt-2 flex flex-wrap items-center gap-1">
      <Hidden teamSlug={teamSlug} campaignId={campaignId} index={index} />
      <span className="mr-0.5 text-[0.6875rem] uppercase tracking-wide text-zinc-400">Design</span>
      {variants.map((v) => {
        const on = v.id === current;
        return (
          <Button key={v.id} label={v.label} type="submit" name="variant" value={v.id} tooltip={v.blurb}
            aria-pressed={on} variant={on ? "primary" : "secondary"} size="sm" />
        );
      })}
    </form>
  );
}

/** Name, URL or slug, all resolved against the live feed. */
function ProductInput({
  teamSlug, campaignId, index, productIndex, value, placeholder,
}: {
  teamSlug: string; campaignId: string; index: number; productIndex: number;
  value: string; placeholder?: string;
}) {
  return (
    <form action={setProduct} className="flex flex-1 gap-1.5">
      <Hidden teamSlug={teamSlug} campaignId={campaignId} index={index} />
      <input type="hidden" name="productIndex" value={productIndex} />
      <input name="value" defaultValue={value} placeholder={placeholder ?? "Product name, URL or slug"} className={inputClass} />
      <Button label="Set" type="submit" size="sm" className="shrink-0" />
    </form>
  );
}

/** Repeated sub-rows, rendered from the block's `items` declaration. */
function ItemsEditor({
  teamSlug, campaignId, index, label, fields, rows, max,
}: {
  teamSlug: string; campaignId: string; index: number; label: string;
  fields: FieldDef[]; rows: Record<string, string>[]; max: number;
}) {
  return (
    <div className="mt-2 space-y-2">
      {rows.map((it, j) => (
        <div key={j} className="rounded border border-zinc-100 bg-zinc-50 p-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[0.6875rem] uppercase tracking-wide text-zinc-400">{label} {j + 1}</span>
            <form action={removeItem}>
              <Hidden teamSlug={teamSlug} campaignId={campaignId} index={index} />
              <input type="hidden" name="itemIndex" value={j} />
              <IconButton label={`Remove ${label} ${j + 1}`} type="submit" variant="ghost" size="sm"
                icon={<Icon icon="close" />} />
            </form>
          </div>
          <form action={updateItem} className="space-y-1.5">
            <Hidden teamSlug={teamSlug} campaignId={campaignId} index={index} />
            <input type="hidden" name="itemIndex" value={j} />
            {fields.map((f) =>
              f.kind === "long" ? (
                <textarea key={f.name} name={f.name} defaultValue={it[f.name] ?? ""} rows={2}
                  placeholder={f.label} className={inputClass} />
              ) : (
                <input key={f.name} name={f.name} defaultValue={it[f.name] ?? ""} placeholder={f.label}
                  className={f.kind === "url" ? monoClass : inputClass} />
              ),
            )}
            <Button label="Save" type="submit" size="sm" className="shrink-0" />
          </form>
        </div>
      ))}
      {rows.length < max && (
        <form action={addItem} className="space-y-1.5 rounded border border-dashed border-zinc-200 p-2">
          <Hidden teamSlug={teamSlug} campaignId={campaignId} index={index} />
          {fields.map((f) =>
            f.kind === "long" ? (
              <textarea key={f.name} name={f.name} rows={2} placeholder={f.label} className={inputClass} />
            ) : (
              <input key={f.name} name={f.name} placeholder={f.label} className={f.kind === "url" ? monoClass : inputClass} />
            ),
          )}
          <Button label={`Add ${label.toLowerCase()}`} type="submit" size="sm" className="shrink-0" />
        </form>
      )}
    </div>
  );
}

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ team: string; id: string }>;
}) {
  const { team: teamSlug, id } = await params;
  const { team } = await requireNewsletterTeam(teamSlug);
  const row = await loadCampaign(id, team.id);
  if (!row) notFound();

  const campaign = {
    brand: row.brandName, domain: row.brandDomain, date: row.sendDate,
    subject: row.subject, preheader: row.preheader, blocks: row.blocks,
  };
  const feed = await loadCatalog(row.brandDomain);
  const cat: Catalog = new Map<string, Resolved | null>();
  for (const n of productNames(campaign)) cat.set(n, resolveOne(n, feed));
  const { inventory, sitemapSeen } = await loadInventory(row.brandId, row.brandDomain);
  // What the content framework asks for on this brand's send weekday, so a
  // block it named but the template had no room for stays visible.
  const fw = await frameworkFor(row.brandId, row.sendDate);
  const present = new Set<string>(row.blocks.map((b) => b.type));
  const missing = fw.matches.filter((m) => m.kind && !present.has(m.kind));
  const unmapped = fw.matches.filter((m) => !m.kind);
  const findings = validate(campaign, cat, inventory, { heroAssetUrl: row.heroAssetUrl });
  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warn");

  const previewBase = `/t/${teamSlug}/newsletter/${row.id}/preview`;
  const previewVersion = row.updatedAt.getTime();
  const lastIndex = row.blocks.length - 1;
  const groups = defsByCategory().filter((g) => g.category !== "furniture");

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <Link href={campaignsPath()} className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" /> All campaigns
      </Link>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{row.subject || "Untitled campaign"}</h1>
          <p className="text-sm text-zinc-500">
            {row.brandName} · {row.sendDate} · {STATUS_LABEL[row.status] ?? row.status}
            {row.approvedBy ? ` · approved by ${row.approvedBy}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action={approveCampaign}>
            <Hidden teamSlug={teamSlug} campaignId={row.id} />
            <Button type="submit" variant="primary" isDisabled={errors.length > 0}
              label={errors.length > 0 ? `Fix ${errors.length} error${errors.length === 1 ? "" : "s"} first` : "Approve"} />
          </form>
          {row.status === "ready" && (
            <form action={handOffCampaign}>
              <Hidden teamSlug={teamSlug} campaignId={row.id} />
              <Button label="Send to SendPulse" type="submit" />
            </form>
          )}
          {row.status === "handed_off" && (
            <span className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
              In SendPulse: finish and send there
            </span>
          )}
        </div>
      </div>

      <details className="mt-5 rounded-lg border border-zinc-200 bg-white">
        <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm font-medium text-zinc-800">
          <HelpCircle className="size-4 text-zinc-500" /> How to edit this campaign
        </summary>
        <ul className="space-y-1.5 border-t border-zinc-100 px-5 py-3 text-sm text-zinc-700">
          <li>· <b>Click any text in the preview</b> to edit it in place. Enter saves, Escape cancels.</li>
          <li>· <b>Blocks</b> below can be reordered, deleted, and added. Header, nav and footer are fixed.</li>
          <li>· <b>Design</b> switches a block to another layout. The copy is kept, so it is safe to try.</li>
          <li>· <b>The framework</b> decided which engagement and product blocks are here, from this brand&rsquo;s themes for this weekday. Anything it asked for that is missing shows as a one-click add.</li>
          <li>· <b>Products</b> accept a name, a full <code className="rounded bg-zinc-100 px-1">/product/…</code> URL, or a slug.</li>
          <li>· <b>Red checks block approval</b>; amber ones are for you to confirm.</li>
          <li>· <b>Editing un-approves</b> the campaign, because an approval describes one exact arrangement.</li>
        </ul>
      </details>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">Checks</h2>
            {findings.length === 0 ? (
              <p className="mt-2 flex items-center gap-1.5 text-sm text-emerald-700">
                <CheckCircle2 className="size-4" /> Every product and link resolves.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {[...errors, ...warnings].map((f, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    {f.level === "error"
                      ? <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" />
                      : <Info className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                    <span className="min-w-0">
                      <span className="font-medium text-zinc-900">{f.where}</span>{" "}
                      <span className="text-zinc-600">{f.message}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {sitemapSeen === 0 && (
              <p className="mt-3 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                No sitemap captured for this brand yet, so collection and category links cannot be checked.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-zinc-900">Subject &amp; hero</h2>
            <form action={updateMeta} className="mt-3 space-y-2">
              <Hidden teamSlug={teamSlug} campaignId={row.id} />
              <input name="subject" defaultValue={row.subject} placeholder="Subject line" className={inputClass} />
              <input name="preheader" defaultValue={row.preheader} placeholder="Preheader" className={inputClass} />
              <input name="heroAssetUrl" defaultValue={row.heroAssetUrl} placeholder="Hero image URL" className={monoClass} />
              <Button label="Save" type="submit" size="sm" />
            </form>

            <div className="mt-4 border-t border-zinc-100 pt-3">
              {row.heroAssetUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={row.heroAssetUrl} alt="Campaign hero" className="mb-3 w-full rounded border border-zinc-200" />
              ) : (
                <p className="mb-3 text-xs text-zinc-500">No hero yet. Generate one, or paste a URL above.</p>
              )}
              <form action={generateHeroAction} className="flex flex-wrap items-center gap-2">
                <Hidden teamSlug={teamSlug} campaignId={row.id} />
                <select name="model" defaultValue={HERO_MODEL} className="rounded border border-zinc-200 px-2 py-1 text-xs">
                  <option value={HERO_MODEL}>GPT Image 2.6 Sunburst, best</option>
                  <option value={HERO_MODEL_FAST}>GPT Image 2.6 Flare, fast</option>
                </select>
                <Button type="submit" variant="primary" size="sm"
                  label={row.heroAssetUrl ? "Regenerate hero" : "Generate hero"}
                  icon={<Sparkles size={16} />} />
                <span className="text-xs text-zinc-400">takes ~30s</span>
              </form>
            </div>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
              <CalendarDays className="size-4 text-zinc-500" /> Content framework
            </h2>
            {fw.sends ? (
              <>
                <p className="mt-1 text-xs text-zinc-500">
                  {WEEKDAY_NAME[fw.weekday]} for {row.brandName}: {fw.themes.join(", ")}.
                </p>
                {missing.length > 0 && (
                  <div className="mt-3">
                    <p className="text-[0.6875rem] uppercase tracking-wide text-zinc-400">Also suggested</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {missing.map((m) => (
                        <form key={m.theme} action={addSuggested}>
                          <Hidden teamSlug={teamSlug} campaignId={row.id} />
                          <input type="hidden" name="afterIndex" value={Math.max(row.blocks.length - 2, 0)} />
                          <input type="hidden" name="blockType" value={m.kind ?? ""} />
                          <Button label={`+ ${m.theme}`} type="submit" size="sm" tooltip={`Add a ${m.label} block`} />
                        </form>
                      ))}
                    </div>
                  </div>
                )}
                {missing.length === 0 && unmapped.length === 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700">
                    <CheckCircle2 className="size-3.5" /> Every theme this weekday asks for is in the email.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-1 text-xs text-zinc-500">
                {row.brandName} has no framework row for a {WEEKDAY_NAME[fw.weekday]}, so this
                campaign uses the template\u2019s own defaults.
              </p>
            )}
            {unmapped.length > 0 && (
              <p className="mt-3 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
                No block matches {unmapped.map((m) => `\u201c${m.theme}\u201d`).join(", ")}.
                The framework has a theme the block catalogue does not cover yet.
              </p>
            )}
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
              <Bookmark className="size-4 text-zinc-500" /> Save as a template
            </h2>
            <form action={saveAsTemplate} className="mt-2 flex flex-wrap items-center gap-1.5">
              <Hidden teamSlug={teamSlug} campaignId={row.id} />
              <input name="name" placeholder="Template name" required className="min-w-40 flex-1 rounded border border-zinc-200 px-2 py-1 text-sm" />
              <label className="flex items-center gap-1 text-[0.6875rem] text-zinc-600">
                <input type="checkbox" name="allBrands" className="size-3" /> all brands
              </label>
              <Button label="Save" type="submit" size="sm" className="shrink-0" />
            </form>
            <p className="mt-1.5 text-[0.6875rem] text-zinc-400">
              Keeps these blocks and this copy exactly as they are now, to start another
              campaign from later.
            </p>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">
              <LayoutTemplate className="size-4 text-zinc-500" /> Start over from a template
            </h2>
            <form action={applyTemplate} className="mt-2 flex flex-wrap items-center gap-1.5">
              <Hidden teamSlug={teamSlug} campaignId={row.id} />
              <select name="templateId" defaultValue={TEMPLATES[0].id}
                className="rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-700">
                {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <Button label="Replace blocks" type="submit" size="sm" className="shrink-0" />
            </form>
            <p className="mt-1.5 text-[0.6875rem] text-zinc-400">
              Replaces every block, re-resolved against the framework for this send date.
              The subject, preheader and hero are kept.
            </p>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white">
            <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900">Blocks</h2>
            <ol className="divide-y divide-zinc-100">
              {row.blocks.map((b, i) => {
                const def = getBlockDef(b.type);
                const fixed = FIXED_KINDS.has(b.type);
                const items = def?.items;
                return (
                  <li key={i} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[0.6875rem] tabular-nums text-zinc-400">{String(i + 1).padStart(2, "0")}</span>
                      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{def?.label ?? b.type}</span>
                      {fixed && <span className="text-[0.6875rem] text-zinc-400">fixed</span>}
                      {!def && <span className="text-[0.6875rem] text-red-600">unknown block, will not render</span>}
                      {!fixed && (
                        <span className="ml-auto flex items-center gap-1">
                          <form action={moveBlock}>
                            <Hidden teamSlug={teamSlug} campaignId={row.id} index={i} />
                            <input type="hidden" name="direction" value="up" />
                            <IconButton label="Move block up" type="submit" size="sm" icon={<Icon icon="arrowUp" />} />
                          </form>
                          <form action={moveBlock}>
                            <Hidden teamSlug={teamSlug} campaignId={row.id} index={i} />
                            <input type="hidden" name="direction" value="down" />
                            <IconButton label="Move block down" type="submit" size="sm" icon={<Icon icon="arrowDown" />} />
                          </form>
                          <form action={deleteBlock}>
                            <Hidden teamSlug={teamSlug} campaignId={row.id} index={i} />
                            <IconButton label="Delete block" type="submit" variant="ghost" size="sm" icon={<Trash2 size={16} />} />
                          </form>
                        </span>
                      )}
                    </div>

                    {def && (
                      <VariantPicker teamSlug={teamSlug} campaignId={row.id} index={i}
                        current={b.variant ?? def.variants[0].id} variants={def.variants} />
                    )}

                    {def?.productSlots === "single" && (() => {
                      const name = val(b, "product");
                      const p = cat.get(name);
                      return (
                        <div className="mt-2 space-y-1">
                          <ProductInput teamSlug={teamSlug} campaignId={row.id} index={i} productIndex={0} value={name} />
                          <div className="pl-1 font-mono text-xs text-zinc-500">
                            {p ? `${p.price} · ${p.availability}` : <span className="text-red-600">no catalog match</span>}
                          </div>
                        </div>
                      );
                    })()}

                    {def?.productSlots === "grid" && (() => {
                      const products = (b as unknown as { products?: string[] }).products ?? [];
                      const columns = (b as unknown as { columns?: number }).columns;
                      return (
                        <div className="mt-2 space-y-1.5">
                          {products.map((n, j) => {
                            const p = cat.get(n);
                            return (
                              <div key={j} className="flex items-center gap-1.5">
                                <ProductInput teamSlug={teamSlug} campaignId={row.id} index={i} productIndex={j} value={n} />
                                <span className="w-32 shrink-0 text-right font-mono text-[0.6875rem] text-zinc-500">
                                  {p ? `${p.price} · ${p.availability}` : <span className="text-red-600">no match</span>}
                                </span>
                                <form action={removeProduct}>
                                  <Hidden teamSlug={teamSlug} campaignId={row.id} index={i} />
                                  <input type="hidden" name="productIndex" value={j} />
                                  <IconButton label={`Remove ${n}`} type="submit" variant="ghost" size="sm" icon={<Icon icon="close" />} />
                                </form>
                              </div>
                            );
                          })}
                          <div className="flex items-center gap-1.5 pt-1">
                            <ProductInput teamSlug={teamSlug} campaignId={row.id} index={i} productIndex={-1}
                              value="" placeholder="Add a product by name, URL or slug" />
                          </div>
                          <p className="pt-0.5 text-[0.6875rem] text-zinc-400">
                            {products.length} product{products.length === 1 ? "" : "s"}
                            {columns ? ` · ${columns} across · rows must be full (2, 3, 4 or 6)` : ""}
                          </p>
                        </div>
                      );
                    })()}

                    {items && (
                      <ItemsEditor teamSlug={teamSlug} campaignId={row.id} index={i}
                        label={items.label} fields={items.fields} rows={list(b, items.prop)} max={items.max ?? 12} />
                    )}

                    {def && def.fields.length > 0 && (
                      <div className="mt-2 grid grid-cols-[88px_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5">
                        {def.fields.map((f) => (
                          <Field key={f.name} teamSlug={teamSlug} campaignId={row.id} index={i} def={f} value={val(b, f.name)} />
                        ))}
                      </div>
                    )}

                    {i < lastIndex && (
                      <form action={addBlock} className="mt-2.5 flex items-center gap-1.5 border-t border-dashed border-zinc-200 pt-2.5">
                        <Hidden teamSlug={teamSlug} campaignId={row.id} />
                        <input type="hidden" name="afterIndex" value={i} />
                        <select name="blockType" defaultValue="band"
                          className="rounded border border-zinc-200 px-1.5 py-0.5 text-[0.6875rem] text-zinc-600">
                          {groups.map((g) => (
                            <optgroup key={g.category} label={g.label}>
                              {g.defs.map((d) => <option key={d.kind} value={d.kind}>{d.label}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <Button label="Insert below" type="submit" size="sm" />
                      </form>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <section className="rounded-lg border border-zinc-200 bg-white p-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold text-zinc-900">Preview</h2>
            <a href={previewBase} target="_blank" rel="noreferrer" className="text-xs text-zinc-500 hover:text-zinc-900">Open the sending HTML</a>
          </div>
          <div className="mb-2">
            <PreviewBridge teamSlug={teamSlug} campaignId={row.id} previewUrl={previewBase} onEdit={updateBlockField} />
          </div>
          {/* The version token is what makes the preview live. A server action
              revalidates this page, but an <iframe> whose src is unchanged is
              never re-fetched, so after generating a hero or editing a block
              the preview kept showing a stale document. Keying the src on
              updatedAt forces a reload on every save. */}
          <iframe
            key={previewVersion}
            title="Email preview"
            src={`${previewBase}?edit=1&v=${previewVersion}`}
            className="h-[1200px] w-full rounded border border-zinc-200 bg-white"
          />
        </section>
      </div>
    </div>
  );
}
