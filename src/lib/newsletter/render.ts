/**
 * Turn a stored campaign into a finished email.
 *
 * Order matters and is not negotiable: resolve, validate, derive, emit. Errors
 * stop the pipeline before anything is rendered, because the failure this is
 * built to prevent -- a plausible-looking link to a page that does not exist --
 * is invisible once it is inside an email.
 */
import { db } from "@/db";
import { newsletterCampaigns } from "@/db/schema";
import { eq } from "drizzle-orm";
import { putObject } from "@/lib/storage";

import type { Campaign, Block } from "./campaign";
import { loadCatalog, resolveOne, type Catalog, type Resolved } from "./catalog";
import { loadInventory } from "./inventory";
import { validate, type Finding } from "./validate";
import { deriveAll, derivativeKey, type Derived } from "./derivatives";
import { emitHtmlEmail, type EmitOptions } from "./emit-html";
import { productNames } from "./links";
import { brandAssets } from "./tokens";

export type RenderInput = {
  campaignId: string;
  brandId: string;
  domain: string;
  campaign: Campaign;
  heroAssetUrl: string;
  derivedImages: { key: string; url: string; bytes: number }[];
  /**
   * Where /public is served from (e.g. https://your-app.vercel.app).
   * Email clients need absolute image URLs, so the header and nav icons are
   * resolved against this.
   */
  assetBase: string;
  /**
   * Where derived images land. Defaults to blob storage, which is what the app
   * uses; injectable so the pipeline can be exercised without a blob token.
   */
  sink?: (d: Derived) => Promise<string>;
  /** Preview-only rendering options (inline editing). Never set on handoff. */
  emit?: EmitOptions;
};

export type RenderResult = {
  html: string;
  findings: Finding[];
  errors: number;
  warnings: number;
  /** Written back to the row so the next render reuses these. */
  derivedImages: { key: string; url: string; bytes: number }[];
  stats: { products: number; unresolved: number; derived: number; reused: number; payloadKb: number };
  sitemapSeen: number;
};

/** Which display width each product is shown at, from the block that holds it. */
function imageJobs(c: Campaign, cat: Catalog) {
  const jobs: Array<{ name: string; url: string; width: number }> = [];
  for (const b of c.blocks) {
    if (b.type === "feature") {
      const p = cat.get(b.product);
      if (p?.imageLink) jobs.push({ name: b.product, url: p.imageLink, width: 400 });
      continue;
    }
    if (b.type !== "productGrid") continue;
    const width = b.columns === 3 ? 200 : 300;
    for (const name of b.products) {
      const p = cat.get(name);
      if (p?.imageLink) jobs.push({ name, url: p.imageLink, width });
    }
  }
  return jobs;
}

export async function renderCampaign(input: RenderInput): Promise<RenderResult> {
  const { campaign: c, brandId, domain } = input;

  // 1. Resolve every product the brief names against the live feed. Live, not
  // the weekly snapshot: a stale "in stock" is exactly the error to catch.
  const feed = await loadCatalog(domain);
  const names = productNames(c);
  const cat: Catalog = new Map<string, Resolved | null>();
  for (const n of names) cat.set(n, resolveOne(n, feed));
  const unresolved = names.filter((n) => !cat.get(n)).length;

  // 2. Validate before rendering anything.
  const { inventory, sitemapSeen } = await loadInventory(brandId, domain);
  const findings = validate(c, cat, inventory, { heroAssetUrl: input.heroAssetUrl });
  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.length - errors;

  if (errors > 0) {
    return {
      html: "", findings, errors, warnings,
      derivedImages: input.derivedImages,
      stats: { products: names.length, unresolved, derived: 0, reused: 0, payloadKb: 0 },
      sitemapSeen,
    };
  }

  // 3. Derive only what is missing. Keys are content-addressed by source URL
  // and width, so swapping one product re-derives one image, not thirteen.
  const cache = new Map(input.derivedImages.map((d) => [d.key, d]));
  const jobs = imageJobs(c, cat);
  const todo = jobs.filter((j) => !cache.has(derivativeKey(j.url, j.width)));

  const sink =
    input.sink ??
    (async (d: Derived) => {
      const { url } = await putObject(`newsletter/${input.campaignId}/${d.key}`, d.buffer, {
        contentType: "image/jpeg",
      });
      return url;
    });

  if (todo.length) {
    await deriveAll(todo, async (d) => {
      const url = await sink(d);
      cache.set(d.key, { key: d.key, url, bytes: d.bytes });
      return url;
    });
  }

  const imgs = new Map<string, string>();
  for (const j of jobs) {
    const hit = cache.get(derivativeKey(j.url, j.width));
    if (hit) imgs.set(j.name, hit.url);
  }

  // 4. Emit.
  const html = emitHtmlEmail(c, cat, input.heroAssetUrl, imgs, brandAssets(input.assetBase, domain) ?? undefined, { ...(input.emit ?? {}), assetBase: input.assetBase });
  const derivedImages = [...cache.values()];
  const payload = jobs.reduce(
    (a, j) => a + (cache.get(derivativeKey(j.url, j.width))?.bytes ?? 0), 0);

  return {
    html, findings, errors, warnings, derivedImages,
    stats: {
      products: names.length,
      unresolved,
      derived: todo.length,
      reused: jobs.length - todo.length,
      payloadKb: Math.round(payload / 1024),
    },
    sitemapSeen,
  };
}

/** Render and persist the derivative cache + validation summary. */
export async function renderAndCache(input: RenderInput): Promise<RenderResult> {
  const out = await renderCampaign(input);
  await db
    .update(newsletterCampaigns)
    .set({
      derivedImages: out.derivedImages,
      validation: {
        errors: out.errors,
        warnings: out.warnings,
        checkedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(newsletterCampaigns.id, input.campaignId));
  return out;
}

/** Narrow the jsonb column back to the block union on read. */
export function asBlocks(raw: unknown): Block[] {
  return Array.isArray(raw) ? (raw as Block[]) : [];
}
