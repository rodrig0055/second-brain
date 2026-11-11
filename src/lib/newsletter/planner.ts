/**
 * Proposes a week of campaigns.
 *
 * Reads the framework (which days, which themes), the calendar, what actually
 * earned clicks, and live catalog signals, then asks the model for one campaign
 * per slot. The output is the same block model a pasted brief produces, so
 * everything downstream (editor, validation, render, approval) is unchanged.
 *
 * Two constraints are enforced in code rather than trusted to the prompt:
 * products must be named exactly as the catalog names them, and every proposal
 * is run through the normal validator before it is stored. A model that invents
 * a product or a collection slug produces a draft with errors on it, not a
 * broken send.
 */
import { generateObject } from "ai";
import { z } from "zod";
import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "@/db";
import { brands, calendarEvents, newsletterCampaigns, newsletterSlots } from "@/db/schema";
import { resolveModel } from "@/lib/models";
import { logUsage } from "@/lib/usage";
import { PLANNER_MODEL } from "./defaults";
import { fullRowCount, gridColumns, type Block, type Campaign } from "./campaign";
import { loadCatalog, resolveOne, type Catalog, type Resolved } from "./catalog";
import { loadResults, sinceDaysAgo, summarise } from "./results";
import { homeUrl } from "./tokens";
import { TEMPLATES, resolveTemplate } from "./templates";
import { matchThemes, silentDay, weekdayOf } from "./framework";

/**
 * The model picks the SHAPE of the email and writes the copy. It does not pick
 * blocks: which engagement and product blocks appear is the content framework's
 * job, resolved from the brand's weekday slot. Asking a model to choose blocks
 * it has no data about was how the earlier version invented arrangements the
 * framework contradicted.
 */
const TEMPLATE_IDS = TEMPLATES.map((t) => t.id) as [string, ...string[]];

/** The skeleton menu as the planner sees it, generated so it cannot drift. */
const TEMPLATE_GUIDE = TEMPLATES
  .map((t) => `  ${t.id}: ${t.blurb} Use when: ${t.useWhen}`)
  .join("\n");

export { PLANNER_MODEL };

/** What the model returns per slot. Deliberately narrower than Block[]. */
const proposal = z.object({
  template: z.enum(TEMPLATE_IDS).describe(
    "The shape of the email. Pick the skeleton whose purpose matches this send.",
  ),
  subject: z.string().describe("Subject line, under 60 characters, no merge tags"),
  preheader: z.string().describe("Preview text, one sentence"),
  heroBadge: z.string().describe("Short campaign label, e.g. '9.9 MEGA SALE'. Empty if none"),
  heroDates: z.string().describe("Date range, e.g. '9-11 SEPTEMBER'. Empty if none"),
  heroHeadline: z.string(),
  heroAccent: z.string().describe("Second headline line, in the accent colour"),
  heroHref: z.string().describe("Full URL the hero links to"),
  sections: z.array(
    z.object({
      headline: z.string(),
      subheadline: z.string().describe("Supporting sentence, or empty"),
      products: z.array(z.string()).describe("Product names copied EXACTLY from the catalog list"),
      ctaLabel: z.string().describe("Button text, or empty for no button"),
      ctaHref: z.string().describe("Full URL for the button"),
    }),
  ).min(1).max(3),
  promoHeadline: z.string().describe("Offer line, e.g. '15% OFF + FREE SHIPPING'"),
  promoCode: z.string().describe("Voucher code, or empty"),
  promoTerms: z.string(),
});

type Proposal = z.infer<typeof proposal>;

/** Block kinds that hold a row of products and so can absorb one section. */
const GRID_KINDS = new Set(["productGrid", "newArrivals", "category"]);

/**
 * Turn a proposal into the block model.
 *
 * Three sources, each authoritative over its own part:
 *   the template  decides the shape
 *   the framework decides which blocks fill the template's slots
 *   the proposal  writes the copy and names the products
 *
 * Each product grid absorbs one of the proposal's sections, and the band
 * immediately before it and the button immediately after it take that section's
 * copy. Blocks the proposal has nothing to say about (a zodiac reading, a
 * delivery promise strip) keep the template's own copy for the marketer to
 * edit, which is the point of "the brain proposes, a human approves".
 */
export function toBlocks(
  p: Proposal,
  domain: string,
  brand = "",
  themes: string[] = [],
  weekday = 0,
): Block[] {
  const home = homeUrl(domain);
  const fw = themes.length
    ? { weekday, themes, matches: matchThemes(themes), voucher: "", sends: true }
    : silentDay(weekday);
  const out = (resolveTemplate(p.template, brand, domain, fw)
    ?? resolveTemplate("engagement-led", brand, domain, fw))?.blocks ?? [];

  // Hero copy, wherever the template puts the hero.
  const heroAt = out.findIndex((b) => b.type === "hero");
  if (heroAt >= 0) {
    out[heroAt] = {
      ...out[heroAt],
      badge: p.heroBadge || undefined,
      dates: p.heroDates || undefined,
      headline: p.heroHeadline,
      headlineAccent: p.heroAccent || undefined,
      href: p.heroHref || home,
    } as Block;
  }

  // The model will repeat a product inside a grid and across sections if it is
  // not stopped; a grid showing the same bouquet twice reads as a bug.
  const used = new Set<string>();
  const freshOf = (names: string[]) =>
    names.filter((n) => {
      const k = n.toLowerCase().trim();
      if (used.has(k)) return false;
      used.add(k);
      return true;
    });

  const sections = [...p.sections];
  let si = 0;

  for (let i = 0; i < out.length && si < sections.length; i++) {
    const b = out[i];
    const isGrid = GRID_KINDS.has(b.type);
    const isFeature = b.type === "feature";
    if (!isGrid && !isFeature) continue;

    const s = sections[si++];
    const fresh = freshOf(s.products);

    if (isFeature) {
      out[i] = { ...b, product: fresh[0] ?? "" } as Block;
    } else {
      // Rows must be full: trim to the largest count that fills them rather
      // than shipping a lone tile. The prompt asks for 3 or 6; this is the guard.
      const keep = fresh.slice(0, fullRowCount(fresh.length));
      const columns = gridColumns(keep.length) ?? 3;
      out[i] = { ...b, products: keep, columns } as Block;
    }

    const before = out[i - 1];
    if (before?.type === "band") {
      out[i - 1] = { ...before, line1: s.headline, sub: s.subheadline || undefined } as Block;
    }
    const after = out[i + 1];
    if (after?.type === "cta" && s.ctaLabel) {
      out[i + 1] = { ...after, label: s.ctaLabel, href: s.ctaHref || home } as Block;
    }
  }

  // A template with fewer grids than the proposal has sections: the rest are
  // appended in the shipped band + grid + button shape rather than dropped.
  const tail: Block[] = [];
  for (; si < sections.length; si++) {
    const s = sections[si];
    tail.push({ type: "band", line1: s.headline, sub: s.subheadline || undefined });
    const fresh = freshOf(s.products);
    if (fresh.length === 1) {
      tail.push({ type: "feature", product: fresh[0] });
    } else {
      const keep = fresh.slice(0, fullRowCount(fresh.length));
      const columns = gridColumns(keep.length);
      if (keep.length && columns) tail.push({ type: "productGrid", columns, products: keep });
    }
    if (s.ctaLabel) tail.push({ type: "cta", label: s.ctaLabel, href: s.ctaHref || home });
  }

  // The offer, into the template's own promo block when it has one.
  const promoAt = out.findIndex((b) => b.type === "promoCode");
  if (p.promoCode) {
    const promo: Block = {
      type: "promoCode",
      variant: promoAt >= 0 ? out[promoAt].variant : undefined,
      headline: p.promoHeadline,
      code: p.promoCode,
      terms: p.promoTerms,
    };
    if (promoAt >= 0) out[promoAt] = promo;
    else tail.push(promo);
  } else if (promoAt >= 0) {
    // A template that expects a code but the week has none: drop the block
    // rather than ship "USE CODE:" with nothing after it.
    out.splice(promoAt, 1);
  }

  if (tail.length) {
    const at = out.findIndex((b) => b.type === "footer");
    out.splice(at < 0 ? out.length : at, 0, ...tail);
  }
  return out;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The dates in a week that this brand actually sends on. */
export async function slotsForWeek(
  brandId: string,
  weekStart: Date,
): Promise<Array<{ date: string; themes: string[]; voucher: string }>> {
  const slots = await db
    .select()
    .from(newsletterSlots)
    .where(and(eq(newsletterSlots.brandId, brandId), eq(newsletterSlots.isActive, true)));

  const out: Array<{ date: string; themes: string[]; voucher: string }> = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    const slot = slots.find((s) => s.weekday === d.getUTCDay());
    if (slot) out.push({ date: ymd(d), themes: slot.themes, voucher: slot.voucher });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export type PlanResult = {
  created: Array<{ id: string; date: string; subject: string; errors: number; warnings: number }>;
  skipped: Array<{ date: string; reason: string }>;
};

/**
 * Plan one brand's week. Existing campaigns on a date are left alone: planning
 * twice must not duplicate or overwrite a draft someone has edited.
 */
export async function planWeek(opts: {
  brandId: string;
  teamId: string;
  weekStart: string;
  userId?: string | null;
  model?: string;
}): Promise<PlanResult> {
  const brand = await db.query.brands.findFirst({ where: eq(brands.id, opts.brandId) });
  if (!brand) throw new Error("brand not found");

  const start = new Date(`${opts.weekStart}T00:00:00Z`);
  const slots = await slotsForWeek(brand.id, start);
  const created: PlanResult["created"] = [];
  const skipped: PlanResult["skipped"] = [];
  if (!slots.length) return { created, skipped: [{ date: opts.weekStart, reason: "no send days configured for this brand" }] };

  // Signals, fetched once for the whole week.
  const feed = await loadCatalog(brand.domain);
  const inStock = feed.filter((p) => p.availability === "in stock");
  const results = summarise(await loadResults(brand.id, sinceDaysAgo(90)));
  const winners = results.top.filter((t) => t.kind === "product").slice(0, 12);

  const windowEnd = new Date(start);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 21);
  const events = await db
    .select()
    .from(calendarEvents)
    .where(and(
      eq(calendarEvents.isActive, true),
      gte(calendarEvents.date, ymd(start)),
      lte(calendarEvents.date, ymd(windowEnd)),
    ))
    .orderBy(calendarEvents.date);
  const brandEvents = events.filter(
    (e) => e.brandIds.length === 0 || e.brandIds.includes(brand.id),
  );

  // A catalog sample the model can name products from. Capped so the prompt
  // stays cacheable and the model is not asked to read 326 lines of noise.
  const catalogSample = inStock
    .slice(0, 140)
    .map((p) => `${p.title}  ${p.price}`)
    .join("\n");

  // Without the real destination list the model links every button to the
  // homepage, because the prompt tells it not to guess. Give it the actual
  // inventory and the buttons become useful.
  const { loadInventory: loadInv } = await import("./inventory");
  const { inventory: inv } = await loadInv(brand.id, brand.domain);
  const destinations = [
    ...[...inv.collections].sort().map((c) => `/collection/${c}`),
    ...[...inv.searchPaths].sort().map((p) => `/search/${p}`),
  ];

  const model = await resolveModel(opts.model ?? PLANNER_MODEL);

  for (const slot of slots) {
    const existing = await db
      .select({ id: newsletterCampaigns.id })
      .from(newsletterCampaigns)
      .where(and(
        eq(newsletterCampaigns.brandId, brand.id),
        eq(newsletterCampaigns.sendDate, slot.date),
      ))
      .limit(1);
    if (existing.length) {
      skipped.push({ date: slot.date, reason: "a campaign already exists for this date" });
      continue;
    }

    const weekday = new Date(`${slot.date}T00:00:00Z`).toLocaleDateString("en-GB", {
      weekday: "long", timeZone: "UTC",
    });

    const prompt = [
      `Plan the ${brand.name} newsletter for ${weekday} ${slot.date}.`,
      ``,
      `TODAY'S THEMES (from the content framework): ${slot.themes.join(", ")}`,
      `STANDING OFFER: ${slot.voucher}`,
      ``,
      brandEvents.length
        ? `CALENDAR (next three weeks):\n${brandEvents.map((e) => `  ${e.date}  ${e.name}${e.notes ? `: ${e.notes}` : ""}`).join("\n")}`
        : `CALENDAR: nothing in the next three weeks.`,
      ``,
      results.sends
        ? [
            `WHAT EARNS CLICKS (last 90 days, ${results.sends} sends, ${results.clicks} clicks):`,
            ...results.byKind.map((k) => `  ${k.kind}: ${(k.share * 100).toFixed(0)}% of clicks`),
            winners.length ? `  best-performing products: ${winners.map((w) => w.label.replace(/^Product: /, "")).join(", ")}` : "",
          ].filter(Boolean).join("\n")
        : `WHAT EARNS CLICKS: no history synced yet.`,
      ``,
      `CATALOG - name products EXACTLY as they appear here, and only from here:`,
      catalogSample,
      ``,
      `EMAIL SHAPES - pick the one whose purpose matches this send.`,
      `You choose the shape and write the copy; which engagement and product`,
      `blocks appear is already decided by the framework themes above.`,
      TEMPLATE_GUIDE,
      ``,
      `Write 1-3 sections. Product grids MUST be 3 or 6 items (2 or 4 is acceptable); never 5 or 7: rows must be full.`,
      `CTA DESTINATIONS - use these paths verbatim, prefixed with https://${brand.domain}.`,
      `Pick the one that matches what the section promises. Never invent a path:`,
      destinations.join("\n"),
      ``,
      `Do not feature the same product twice in one email.`,
    ].join("\n");

    let object: Proposal;
    try {
      const result = await generateObject({
        model,
        schema: proposal,
        prompt,
        system:
          "You plan e-commerce gifting newsletters. You write warm, specific, " +
          "concrete copy, never generic marketing filler. You never invent a " +
          "product that is not in the supplied catalog.",
      });
      object = result.object;
      await logUsage({
        kind: "task",
        model: opts.model ?? PLANNER_MODEL,
        usage: result.usage,
        userId: opts.userId,
        brandId: brand.id,
        teamId: opts.teamId,
      });
    } catch (err) {
      // Never silently fall back to a different model: a marketer who chose
      // Opus 5 must not receive copy from something else and be told it
      // worked. Name the real cause so it is fixable.
      const msg = err instanceof Error ? err.message : String(err);
      const modelId = opts.model ?? PLANNER_MODEL;
      if (/credit balance is too low/i.test(msg))
        throw new Error(
          `${modelId} is out of credit on this account. Top up the provider, or pick a different model in the Model dropdown.`,
        );
      if (/API key is missing|LoadAPIKey/i.test(msg))
        throw new Error(
          `${modelId} has no API key configured on this deployment. Pick a different model, or set the provider key.`,
        );
      throw new Error(`${modelId} failed to plan ${slot.date}: ${msg.slice(0, 200)}`);
    }

    const blocks = toBlocks(object, brand.domain, brand.name, slot.themes, weekdayOf(slot.date));

    // Validate immediately, so the draft carries its own findings.
    const cat: Catalog = new Map<string, Resolved | null>();
    for (const b of blocks)
      if (b.type === "productGrid") for (const n of b.products) cat.set(n, resolveOne(n, feed));

    const { validate } = await import("./validate");
    const inventory = inv;
    const campaign: Campaign = {
      brand: brand.name, domain: brand.domain, date: slot.date,
      subject: object.subject, preheader: object.preheader, blocks,
    };
    const findings = validate(campaign, cat, inventory);
    const errors = findings.filter((f) => f.level === "error").length;

    const [row] = await db
      .insert(newsletterCampaigns)
      .values({
        brandId: brand.id, teamId: opts.teamId, sendDate: slot.date,
        subject: object.subject, preheader: object.preheader, blocks,
        status: "draft", createdById: opts.userId ?? null,
        validation: { errors, warnings: findings.length - errors, checkedAt: new Date().toISOString() },
      })
      .returning({ id: newsletterCampaigns.id });

    created.push({
      id: row.id, date: slot.date, subject: object.subject,
      errors, warnings: findings.length - errors,
    });
  }

  return { created, skipped };
}
