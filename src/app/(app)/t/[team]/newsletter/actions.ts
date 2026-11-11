"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { brands, newsletterCampaigns, newsletterTemplates } from "@/db/schema";
import {
  campaignPath,
  campaignsPath,
  requireNewsletterTeam,
} from "@/lib/newsletter/access";
import { loadCatalog, resolveInput } from "@/lib/newsletter/catalog";
import { parseBrief } from "@/lib/newsletter/parse-brief";
import { loadCampaign } from "@/lib/newsletter/store";
import type { Block } from "@/lib/newsletter/campaign";
import { getBlockDef, FIXED_KINDS } from "@/lib/newsletter/blocks";
import { getTemplate, resolveTemplate, templateContext } from "@/lib/newsletter/templates";
import { frameworkFor } from "@/lib/newsletter/store";
import { fillProducts } from "@/lib/newsletter/autofill";

/**
 * Every action re-authorises from scratch: the team slug arrives as a form
 * field, so it is client-supplied and cannot be trusted. `requireNewsletterTeam`
 * runs `requireTeam` (which re-reads the user row) and re-checks the slug.
 */
async function authorize(formData: FormData) {
  return requireNewsletterTeam(String(formData.get("teamSlug") ?? ""));
}

/** Where /public is served from, for absolute image URLs inside the email. */
function assetBase(): string {
  const v = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return v ? `https://${v}` : "http://localhost:3000";
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Create a campaign from a pasted brief, in the format the team already writes. */
export async function createFromBrief(formData: FormData) {
  const { user, team } = await authorize(formData);

  const brandId = str(formData, "brandId");
  const sendDate = str(formData, "sendDate");
  const brief = String(formData.get("brief") ?? "");
  if (!brandId || !sendDate || !brief.trim()) return;

  const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
  if (!brand) return;

  // Products are identified by matching the catalog, so the parse needs the
  // feed. A brief naming something that no longer exists comes back unmatched
  // rather than becoming a headline.
  const feed = await loadCatalog(brand.domain);
  const { campaign } = parseBrief(brief, feed, {
    date: sendDate,
    subject: str(formData, "subject"),
    domain: brand.domain,
  });

  const [row] = await db
    .insert(newsletterCampaigns)
    .values({
      brandId,
      teamId: team.id,
      sendDate,
      subject: campaign.subject,
      preheader: campaign.preheader,
      blocks: campaign.blocks,
      status: "draft",
      createdById: user.id,
    })
    .returning({ id: newsletterCampaigns.id });

  revalidatePath(campaignsPath());
  redirect(campaignPath(row.id));
}

/**
 * Ask the brain to propose the week.
 *
 * Drafts land with their validation already run, so a proposal that invented a
 * product arrives visibly broken rather than looking finished.
 */
export async function planTheWeek(formData: FormData) {
  const { user, team } = await authorize(formData);
  const brandId = str(formData, "brandId");
  const weekStart = str(formData, "weekStart");
  if (!brandId || !weekStart) return;

  const { planWeek } = await import("@/lib/newsletter/planner");
  const model = str(formData, "model") || undefined;
  await planWeek({ brandId, teamId: team.id, weekStart, userId: user.id, model });
  revalidatePath(campaignsPath());
}

/** Load a campaign the caller is allowed to touch, or bail. */
async function owned(formData: FormData) {
  const { user, team } = await authorize(formData);
  const id = str(formData, "campaignId");
  const row = id ? await loadCampaign(id, team.id) : null;
  return row ? { user, team, row } : null;
}

/**
 * Patch one field of one block.
 *
 * Editing is field-at-a-time on purpose: the blocks column is the source of
 * truth for both renderers, so a whole-array write from a stale form would
 * silently discard a concurrent edit.
 */
export async function updateBlockField(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;

  const index = Number(str(formData, "blockIndex"));
  const field = str(formData, "field");
  const value = String(formData.get("value") ?? "");
  const blocks = [...ctx.row.blocks];
  if (!Number.isInteger(index) || index < 0 || index >= blocks.length) return;

  // The block's own module declares what it has. A hand-maintained global
  // allowlist used to sit here and silently dropped edits to any field someone
  // forgot to add, and it let a field name from one block write onto another.
  const def = getBlockDef(blocks[index].type);
  if (!def?.fields.some((f) => f.name === field)) return;

  blocks[index] = { ...blocks[index], [field]: value } as Block;

  await db
    .update(newsletterCampaigns)
    .set({ blocks, updatedAt: new Date(), approvedById: null, approvedAt: null, status: "draft" })
    .where(eq(newsletterCampaigns.id, ctx.row.id));

  revalidatePath(campaignPath(ctx.row.id));
}

/**
 * Persist a new block array. Any structural edit un-approves the campaign:
 * an approval is a statement about a specific arrangement of blocks, and it
 * must not survive the arrangement changing.
 */
async function writeBlocks(campaignId: string, blocks: Block[]) {
  await db
    .update(newsletterCampaigns)
    .set({ blocks, updatedAt: new Date(), approvedById: null, approvedAt: null, status: "draft" })
    .where(eq(newsletterCampaigns.id, campaignId));
  revalidatePath(campaignPath(campaignId));
}

/**
 * Structural edits.
 *
 * Furniture (header, nav, footer) is the frame of every send: it cannot be
 * moved, deleted or inserted twice. Which kinds count as furniture comes from
 * the registry, so a new frame block is covered without editing this file.
 */
export async function moveBlock(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const i = Number(str(formData, "blockIndex"));
  const dir = str(formData, "direction") === "up" ? -1 : 1;
  const blocks = [...ctx.row.blocks];
  const j = i + dir;
  if (!Number.isInteger(i) || i < 0 || i >= blocks.length || j < 0 || j >= blocks.length) return;
  // Nothing moves past the frame.
  if (FIXED_KINDS.has(blocks[i].type) || FIXED_KINDS.has(blocks[j].type)) return;
  [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
  await writeBlocks(ctx.row.id, blocks);
}

export async function deleteBlock(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const i = Number(str(formData, "blockIndex"));
  const blocks = [...ctx.row.blocks];
  if (!Number.isInteger(i) || i < 0 || i >= blocks.length || FIXED_KINDS.has(blocks[i].type)) return;
  blocks.splice(i, 1);
  await writeBlocks(ctx.row.id, blocks);
}

/** The context a block needs to spawn itself with sensible defaults. */
function emptyCtx(row: { brandName: string; brandDomain: string }) {
  return templateContext(row.brandName, row.brandDomain);
}

export async function addBlock(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const def = getBlockDef(str(formData, "blockType"));
  // Furniture is part of the frame; it is never inserted by hand.
  if (!def || def.category === "furniture") return;

  const block = def.empty(emptyCtx(ctx.row)) as Block;
  const variant = str(formData, "variant");
  if (variant && def.variants.some((v) => v.id === variant)) block.variant = variant;

  const after = Number(str(formData, "afterIndex"));
  const blocks = [...ctx.row.blocks];
  // Never insert beyond the footer.
  const footerAt = blocks.findIndex((b) => b.type === "footer");
  const at = Math.min(Number.isInteger(after) ? after + 1 : blocks.length, footerAt < 0 ? blocks.length : footerAt);
  blocks.splice(at, 0, block);
  await writeBlocks(ctx.row.id, blocks);
}

/**
 * Switch one block to a different design.
 *
 * Variants share the block's data, so this never destroys copy: an unknown or
 * stale variant id falls back to the block's first design at render time.
 */
export async function setVariant(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const i = Number(str(formData, "blockIndex"));
  const variant = str(formData, "variant");
  const blocks = [...ctx.row.blocks];
  if (!Number.isInteger(i) || i < 0 || i >= blocks.length) return;
  const def = getBlockDef(blocks[i].type);
  if (!def || !def.variants.some((v) => v.id === variant)) return;
  blocks[i] = { ...blocks[i], variant } as Block;
  await writeBlocks(ctx.row.id, blocks);
}

/**
 * Replace the whole arrangement with a template's.
 *
 * Destructive by design: it is how you say "this week is a flash offer, not a
 * gift guide". The UI asks first, and the un-approve in `writeBlocks` means a
 * template swap can never carry an old approval forward.
 */
export async function applyTemplate(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  // Re-resolved against THIS campaign's own send date, so swapping template on a
  // Saturday draft gets Saturday's engagement block, not the one it had.
  const blocks = await buildFromTemplate(
    str(formData, "templateId"), ctx.row.brandId, ctx.row.brandName,
    ctx.row.brandDomain, ctx.row.sendDate,
  );
  if (!blocks) return;
  await writeBlocks(ctx.row.id, blocks.blocks);
}

/**
 * Template plus framework plus catalog: the whole "arrives nearly ready" path.
 *
 * The template decides the shape, the framework decides which blocks fill its
 * slots for that brand and weekday, and the feed fills the product grids.
 */
async function buildFromTemplate(
  templateId: string,
  brandId: string,
  brandName: string,
  domain: string,
  sendDate: string,
) {
  const fw = await frameworkFor(brandId, sendDate);
  const resolved = resolveTemplate(templateId, brandName, domain, fw);
  if (!resolved) return null;
  const filled = await fillProducts(resolved.blocks, brandId, domain);
  return { ...resolved, blocks: filled.blocks, fillSource: filled.source };
}

/**
 * Start a new campaign from a template.
 *
 * It arrives close to sendable: real copy from the template, the engagement and
 * product blocks the framework names for that brand on that weekday, and grids
 * already filled from the live feed.
 */
export async function createFromTemplate(formData: FormData) {
  const { user, team } = await authorize(formData);
  const brandId = str(formData, "brandId");
  const sendDate = str(formData, "sendDate");
  const templateId = str(formData, "templateId");
  if (!brandId || !sendDate || !templateId) return;

  const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
  const template = getTemplate(templateId);
  if (!brand || !template) return;

  const built = await buildFromTemplate(templateId, brandId, brand.name, brand.domain, sendDate);
  if (!built) return;

  const [row] = await db
    .insert(newsletterCampaigns)
    .values({
      brandId,
      teamId: team.id,
      sendDate,
      subject: str(formData, "subject") || template.subject,
      preheader: template.preheader,
      blocks: built.blocks,
      status: "draft",
      createdById: user.id,
    })
    .returning({ id: newsletterCampaigns.id });

  revalidatePath(campaignsPath());
  redirect(campaignPath(row.id));
}

/**
 * Save this campaign's arrangement and copy as a reusable template.
 *
 * Copy is kept, not stripped: the request this answers is "make another one
 * like that". Scoped to the campaign's brand by default, because a saved
 * template usually names that brand's products.
 */
export async function saveAsTemplate(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const name = str(formData, "name");
  if (!name) return;
  const allBrands = str(formData, "allBrands") === "on";

  await db.insert(newsletterTemplates).values({
    brandId: allBrands ? null : ctx.row.brandId,
    teamId: ctx.team.id,
    name,
    blocks: ctx.row.blocks,
    subject: ctx.row.subject,
    preheader: ctx.row.preheader,
    createdById: ctx.user.id,
  });

  revalidatePath(campaignPath(ctx.row.id));
  revalidatePath(campaignsPath());
}

/** Start a new campaign from a saved template. Blocks are used exactly as saved. */
export async function createFromSaved(formData: FormData) {
  const { user, team } = await authorize(formData);
  const brandId = str(formData, "brandId");
  const sendDate = str(formData, "sendDate");
  const savedId = str(formData, "savedId");
  if (!brandId || !sendDate || !savedId) return;

  const saved = await db.query.newsletterTemplates.findFirst({
    where: and(eq(newsletterTemplates.id, savedId), eq(newsletterTemplates.teamId, team.id)),
  });
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
  if (!saved || !brand) return;

  const [row] = await db
    .insert(newsletterCampaigns)
    .values({
      brandId,
      teamId: team.id,
      sendDate,
      subject: str(formData, "subject") || saved.subject,
      preheader: saved.preheader,
      blocks: (Array.isArray(saved.blocks) ? saved.blocks : []) as Block[],
      status: "draft",
      createdById: user.id,
    })
    .returning({ id: newsletterCampaigns.id });

  revalidatePath(campaignsPath());
  redirect(campaignPath(row.id));
}

export async function deleteSavedTemplate(formData: FormData) {
  const { team } = await authorize(formData);
  const savedId = str(formData, "savedId");
  if (!savedId) return;
  await db.delete(newsletterTemplates)
    .where(and(eq(newsletterTemplates.id, savedId), eq(newsletterTemplates.teamId, team.id)));
  revalidatePath(campaignsPath());
}

/**
 * Insert a block the framework asked for but the template had no holeize for.
 * Same as addBlock, but named so the editor can offer it as "the framework also
 * suggests" rather than burying it in the generic add menu.
 */
export async function addSuggested(formData: FormData) {
  return addBlock(formData);
}

/**
 * Set or append a product. `value` is whatever was typed: a product URL, a slug,
 * or a name, all resolved against the live feed. The stored value is the
 * catalog's own title so the grid reads cleanly. Unresolvable input is stored
 * verbatim so the checks panel can name it.
 *
 * Works for any block that declares product slots, not just the grid.
 */
export async function setProduct(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const i = Number(str(formData, "blockIndex"));
  const j = Number(str(formData, "productIndex"));
  const value = str(formData, "value");
  if (!value) return;
  const blocks = [...ctx.row.blocks];
  const b = blocks[i] as Block & { products?: string[]; product?: string; columns?: 2 | 3 };
  const def = b ? getBlockDef(b.type) : null;
  if (!def?.productSlots) return;

  const feed = await loadCatalog(ctx.row.brandDomain);
  const hit = resolveInput(value, feed);
  const name = hit?.title ?? value;

  if (def.productSlots === "single") {
    blocks[i] = { ...b, product: name } as Block;
  } else {
    const products = [...(b.products ?? [])];
    if (j >= 0 && j < products.length) products[j] = name;
    else products.push(name);
    blocks[i] = { ...b, products, ...columnsFor(products.length, b.columns) } as Block;
  }
  await writeBlocks(ctx.row.id, blocks);
}

export async function removeProduct(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const i = Number(str(formData, "blockIndex"));
  const j = Number(str(formData, "productIndex"));
  const blocks = [...ctx.row.blocks];
  const b = blocks[i] as Block & { products?: string[]; columns?: 2 | 3 };
  const def = b ? getBlockDef(b.type) : null;
  if (!def || def.productSlots !== "grid" || !b.products || j < 0 || j >= b.products.length) return;
  const products = b.products.filter((_, k) => k !== j);
  blocks[i] = { ...b, products, ...columnsFor(products.length, b.columns) } as Block;
  await writeBlocks(ctx.row.id, blocks);
}

/**
 * Keep the column count consistent with the full-rows rule. The validator still
 * blocks a count that cannot fill its rows, so this only picks the obvious
 * layout and leaves the count itself to the marketer.
 */
function columnsFor(n: number, current: 2 | 3 | undefined): { columns?: 2 | 3 } {
  if (current === undefined) return {};
  return { columns: n % 3 === 0 ? 3 : n % 2 === 0 ? 2 : current };
}

/**
 * Repeated sub-rows: reviews, guide rows, categories, tips, photos.
 *
 * One generic implementation rather than a pair of actions per block. Which
 * array to touch and which fields it holds both come from the block's own
 * `items` declaration.
 */
function itemsOf(block: Block): { prop: string; fields: Set<string>; max: number; list: Record<string, string>[] } | null {
  const def = getBlockDef(block.type);
  if (!def?.items) return null;
  const list = (block as unknown as Record<string, unknown>)[def.items.prop];
  return {
    prop: def.items.prop,
    fields: new Set(def.items.fields.map((f) => f.name)),
    max: def.items.max ?? 12,
    list: Array.isArray(list) ? (list as Record<string, string>[]) : [],
  };
}

export async function addItem(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const i = Number(str(formData, "blockIndex"));
  const blocks = [...ctx.row.blocks];
  const meta = blocks[i] ? itemsOf(blocks[i]) : null;
  if (!meta || meta.list.length >= meta.max) return;

  const item: Record<string, string> = {};
  for (const name of meta.fields) item[name] = str(formData, name);
  // An entirely empty row is a misclick, not an edit.
  if (!Object.values(item).some((v) => v)) return;

  blocks[i] = { ...blocks[i], [meta.prop]: [...meta.list, item] } as Block;
  await writeBlocks(ctx.row.id, blocks);
}

export async function removeItem(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const i = Number(str(formData, "blockIndex"));
  const j = Number(str(formData, "itemIndex"));
  const blocks = [...ctx.row.blocks];
  const meta = blocks[i] ? itemsOf(blocks[i]) : null;
  if (!meta || j < 0 || j >= meta.list.length) return;
  blocks[i] = { ...blocks[i], [meta.prop]: meta.list.filter((_, k) => k !== j) } as Block;
  await writeBlocks(ctx.row.id, blocks);
}

/** Save every field of one sub-row at once, which is how the editor submits it. */
export async function updateItem(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const i = Number(str(formData, "blockIndex"));
  const j = Number(str(formData, "itemIndex"));
  const blocks = [...ctx.row.blocks];
  const meta = blocks[i] ? itemsOf(blocks[i]) : null;
  if (!meta || j < 0 || j >= meta.list.length) return;
  const patch: Record<string, string> = {};
  for (const name of meta.fields) patch[name] = str(formData, name);
  const list = meta.list.map((it, k) => (k === j ? { ...it, ...patch } : it));
  blocks[i] = { ...blocks[i], [meta.prop]: list } as Block;
  await writeBlocks(ctx.row.id, blocks);
}

export async function updateItemField(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const i = Number(str(formData, "blockIndex"));
  const j = Number(str(formData, "itemIndex"));
  const field = str(formData, "field");
  const value = String(formData.get("value") ?? "");
  const blocks = [...ctx.row.blocks];
  const meta = blocks[i] ? itemsOf(blocks[i]) : null;
  if (!meta || j < 0 || j >= meta.list.length || !meta.fields.has(field)) return;
  const list = meta.list.map((it, k) => (k === j ? { ...it, [field]: value } : it));
  blocks[i] = { ...blocks[i], [meta.prop]: list } as Block;
  await writeBlocks(ctx.row.id, blocks);
}

/**
 * Generate the hero with GPT Image 2.5 and set it on the campaign. Slow
 * (tens of seconds); the page's maxDuration covers it. A regenerate simply
 * replaces the URL — old files stay in blob storage until cleaned up.
 */
export async function generateHeroAction(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const { generateHero } = await import("@/lib/newsletter/hero");
  const { url } = await generateHero({
    campaignId: ctx.row.id,
    brandId: ctx.row.brandId,
    brandName: ctx.row.brandName,
    domain: ctx.row.brandDomain,
    blocks: ctx.row.blocks,
    modelId: str(formData, "model") || undefined,
    userId: ctx.user.id,
    teamId: ctx.team.id,
  });
  await db
    .update(newsletterCampaigns)
    .set({ heroAssetUrl: url, updatedAt: new Date() })
    .where(eq(newsletterCampaigns.id, ctx.row.id));
  revalidatePath(campaignPath(ctx.row.id));
}

/** Subject and preheader live on the row, not in a block. */
export async function updateMeta(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  await db
    .update(newsletterCampaigns)
    .set({
      subject: str(formData, "subject"),
      preheader: str(formData, "preheader"),
      heroAssetUrl: str(formData, "heroAssetUrl"),
      updatedAt: new Date(),
    })
    .where(eq(newsletterCampaigns.id, ctx.row.id));
  revalidatePath(campaignPath(ctx.row.id));
}

/**
 * Approve. Deliberately re-renders first rather than trusting the cached
 * validation summary: approving is the gate that lets a campaign reach
 * SendPulse, and the catalog can go out of stock between the last preview and
 * this click.
 */
export async function approveCampaign(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;

  const { renderCampaign } = await import("@/lib/newsletter/render");
  const result = await renderCampaign({
    campaignId: ctx.row.id,
    brandId: ctx.row.brandId,
    domain: ctx.row.brandDomain,
    campaign: {
      brand: ctx.row.brandName,
      domain: ctx.row.brandDomain,
      date: ctx.row.sendDate,
      subject: ctx.row.subject,
      preheader: ctx.row.preheader,
      blocks: ctx.row.blocks,
    },
    heroAssetUrl: ctx.row.heroAssetUrl,
    derivedImages: ctx.row.derivedImages,
    assetBase: assetBase(),
  });

  if (result.errors > 0) {
    // Nothing is approved on a failing render. The page re-reads the findings.
    await db
      .update(newsletterCampaigns)
      .set({
        validation: { errors: result.errors, warnings: result.warnings, checkedAt: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(newsletterCampaigns.id, ctx.row.id));
    revalidatePath(campaignPath(ctx.row.id));
    return;
  }

  await db
    .update(newsletterCampaigns)
    .set({
      status: ctx.row.heroAssetUrl ? "ready" : "needs_art",
      approvedById: ctx.user.id,
      approvedAt: new Date(),
      derivedImages: result.derivedImages,
      validation: { errors: 0, warnings: result.warnings, checkedAt: new Date().toISOString() },
      updatedAt: new Date(),
    })
    .where(eq(newsletterCampaigns.id, ctx.row.id));

  revalidatePath(campaignPath(ctx.row.id));
  revalidatePath(campaignsPath());
}

/**
 * Push the approved email to SendPulse as a template.
 *
 * This is the last thing the brain does. It creates no campaign and sends
 * nothing; a person finishes in SendPulse. Note that templates cannot be
 * deleted through the API, so this is not a step to run speculatively.
 */
export async function handOffCampaign(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  const { handOff } = await import("@/lib/newsletter/handoff");
  await handOff(ctx.row);
  revalidatePath(campaignPath(ctx.row.id));
  revalidatePath(campaignsPath());
}

export async function archiveCampaign(formData: FormData) {
  const ctx = await owned(formData);
  if (!ctx) return;
  await db
    .update(newsletterCampaigns)
    .set({ status: "archived", updatedAt: new Date() })
    .where(and(eq(newsletterCampaigns.id, ctx.row.id)));
  revalidatePath(campaignsPath());
  redirect(campaignsPath());
}
