/**
 * Pre-flight validation for a generated campaign.
 *
 * The reason this exists: while building the 9/11 comparison I "fixed" a
 * copy/link mismatch by pointing a CTA at /search/flower/mixed-bouquet, which
 * does not exist. It looked plausible and would have shipped as a 404. Any
 * model proposing campaigns will invent slugs the same way, so every outbound
 * URL has to be checked against a real inventory before a human ever sees it.
 *
 * Storefront pages sit behind Cloudflare and return 403 to this machine, so
 * HTTP checking is useless -- valid and invalid URLs look identical. The
 * inventory has to come from data:
 *   products      -> the public product feed
 *   collections   -> tenantSG.collections           (published = 1)
 *   /search/a/b   -> tenantSG.sub_categories + categories
 *
 * In the app, the same inventory should come from the weekly storefront
 * snapshot in Neon rather than MySQL, which Vercel cannot reach.
 */
import type { Campaign } from "./campaign";
import type { Catalog } from "./catalog";
import { linkUnits, productNames, blockImages } from "./links";
import { getBlockDef } from "./blocks";
import { hasBrandAssets, hasSocials, badSocialOverrides, hasApp } from "./tokens";

export type Inventory = {
  products: Set<string>;      // slug
  collections: Set<string>;   // slug
  searchPaths: Set<string>;   // "occasions/birthday"
};

export type Finding = { level: "error" | "warn"; where: string; message: string };

export type ValidateOpts = { heroAssetUrl?: string };

export function validate(
  c: Campaign,
  cat: Catalog,
  inv: Inventory,
  opts: ValidateOpts = {},
): Finding[] {
  const out: Finding[] = [];

  // Only brands whose real slices have been committed get an image lockup;
  // everyone else renders their name as text. Worth saying out loud, because
  // the alternative anyone would assume is that the logo is simply missing.
  if (c.blocks.some((b) => b.type === "header") && !hasBrandAssets(c.domain))
    out.push({
      level: "warn", where: "Brand assets",
      message: `none supplied for ${c.domain}, so this email has NO logo and NO occasion icons. There is no text substitute on purpose: a brand name set in headline type reads as a logo that failed to load. Add the slices under public/newsletter/.`,
    });

  // A social field filled with something that is not a URL. Worth an error
  // rather than a warning: the marketer typed it expecting it to appear, and
  // silently falling back to the brand profile would hide that it did nothing.
  for (const b of c.blocks) {
    if (b.type !== "footer") continue;
    const f = b as unknown as Record<string, string | undefined>;
    for (const n of badSocialOverrides({ instagram: f.instagram, facebook: f.facebook, tiktok: f.tiktok }))
      out.push({
        level: "error", where: `Footer ${n}`,
        message: `"${(f[n] ?? "").slice(0, 40)}" is not a link. These fields take a full profile URL and override the brand's own; leave one blank to use the brand profile.`,
      });
  }

  // An app push for a brand with no confirmed listing renders no badges, which
  // is a block asking people to download something with no way to do it.
  if (c.blocks.some((b) => b.type === "appPromo") && !hasApp(c.domain))
    out.push({
      level: "error", where: "App listing",
      message: `no confirmed App Store or Google Play listing for ${c.domain}, so this block shows no badges. Remove it, or add the listing URLs in tokens.ts.`,
    });

  // The footer always shows social icons, so a brand with no confirmed profiles
  // ships a footer with none. Guessing a URL from the domain would point
  // subscribers at whoever actually owns that handle, so it is asked for.
  if (c.blocks.some((b) => b.type === "footer") && !hasSocials(c.domain))
    out.push({
      level: "warn", where: "Social profiles",
      message: `none confirmed for ${c.domain}, so the footer shows no social icons. Add them in tokens.ts once the real profile URLs are known.`,
    });

  // The hero is the one part a designer still supplies. Without it the email
  // renders headline-only, so name it as a gap rather than letting a reviewer
  // meet it as a broken image.
  if (opts.heroAssetUrl !== undefined && c.blocks.some((b) => b.type === "hero")) {
    if (!opts.heroAssetUrl)
      out.push({
        level: "warn", where: "Hero image",
        message: "not set. Add the campaign visual before handing off to SendPulse.",
      });
    else {
      const host = (() => {
        try { return new URL(opts.heroAssetUrl).hostname; } catch { return ""; }
      })();
      // A mail client's image proxy URL renders perfectly in the preview and
      // then fails for every subscriber: it is scoped to the message it was
      // copied from. Easy to paste by accident when lifting art out of an
      // email, and invisible until the send has already gone out.
      if (/googleusercontent\.com$|\.mail\.yahoo\.com$|outlook\.com$/.test(host))
        out.push({
          level: "error", where: "Hero image",
          message: `is a mail-client proxy URL (${host}). It will not load for subscribers: generate a hero, or use the original image URL.`,
        });
      else if (!host)
        out.push({ level: "error", where: "Hero image", message: "is not a valid URL" });
    }
  }

  // Every product any block names must have resolved, and be buyable. The list
  // comes from the registry, so a new block that holds products is covered the
  // moment it is registered. This used to read productGrid only, which meant an
  // unresolvable product in a single-product feature never blocked.
  for (const name of productNames(c)) {
    const p = cat.get(name);
    if (!p) { out.push({ level: "error", where: name, message: "no catalog match, a human must pick the product" }); continue; }
    if (p.availability && p.availability !== "in stock")
      out.push({ level: "error", where: p.title, message: `feed says "${p.availability}", do not feature it` });
    if (p.score < 0.85)
      out.push({ level: "warn", where: name, message: `matched "${p.title}" at ${p.score.toFixed(2)}, confirm this is the right product` });
  }

  // Rows must be full. A grid whose count does not divide by its columns
  // leaves a lone tile, which no shipped send has ever done, so it blocks
  // rather than warning and hoping the reviewer notices it in the preview.
  for (const b of c.blocks) {
    if (getBlockDef(b.type)?.productSlots !== "grid") continue;
    const g = b as unknown as { products?: string[]; columns?: number };
    const n = g.products?.length ?? 0;
    if (!g.columns || n === 0) continue;
    if (n % g.columns !== 0)
      out.push({
        level: "error", where: `${n}-product grid`,
        message: "leaves a lone tile on the last row. Add or remove a product (2, 3, 4 or 6 fill their rows).",
      });
  }

  // A template arrives with its blocks empty on purpose. An empty block that
  // reaches a send renders as a gap or a stray "USE CODE:" with nothing after
  // it, so every one of them has to be named before approval.
  for (const [i, b] of c.blocks.entries()) {
    const def = getBlockDef(b.type);
    if (!def || def.category === "furniture") continue;
    const rec = b as unknown as Record<string, unknown>;
    const hasField = def.fields.some((f) => {
      const v = rec[f.name];
      return typeof v === "string" && v.trim() !== "";
    });
    const hasItems = def.items ? (rec[def.items.prop] as unknown[] | undefined)?.length : 0;
    const hasProducts = (def.products?.(b as never) ?? []).some(Boolean);
    if (!hasField && !hasItems && !hasProducts)
      out.push({
        level: "warn", where: `Block ${i + 1}: ${def.label}`,
        message: "is still empty. Fill it in, or delete it before approving.",
      });
  }

  // Images pasted into a block have the same proxy-URL trap as the hero, and
  // an http:// image is stripped by some clients on an https-served message.
  for (const src of blockImages(c)) {
    let host = "";
    try {
      const u = new URL(src);
      host = u.hostname;
      if (u.protocol !== "https:")
        out.push({ level: "error", where: src, message: "is not an https URL, so it will be blocked in most clients" });
    } catch {
      out.push({ level: "error", where: src, message: "is not a valid image URL" });
      continue;
    }
    if (/googleusercontent\.com$|\.mail\.yahoo\.com$|outlook\.com$/.test(host))
      out.push({
        level: "error", where: src,
        message: `is a mail-client proxy URL (${host}). It will not load for subscribers.`,
      });
  }

  // Every outbound link must exist in the inventory.
  for (const u of linkUnits(c, cat)) {
    if (!u.href) continue;
    let path: string;
    let host: string;
    try {
      const parsed = new URL(u.href);
      host = parsed.hostname.replace(/^www\./, "");
      path = parsed.pathname.replace(/^\/|\/$/g, "");
    }
    catch { out.push({ level: "error", where: u.href, message: "not a valid URL" }); continue; }
    // Off-storefront links are deliberate: social profiles, the app stores, a
    // blog on another host. The rules below all describe STOREFRONT paths, so
    // applying them here only produced false alarms about Instagram.
    if (host !== c.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")) continue;
    if (path === "") continue; // homepage
    const [kind, ...rest] = path.split("/");
    const tail = rest.join("/");
    // Severity follows how authoritative the source is.
    //
    // The product feed is complete: every buyable product is in it, so a
    // product miss is a real broken link and blocks.
    //
    // The sitemap is NOT an existence oracle. It is a current-visibility view,
    // and it omits out-of-season categories: bloomly-sg.example lists 31 of its 38 live
    // subcategories, and the seven missing ones are christmas, cny, mothers-day,
    // fathers-day, eternal-flowers and two gourmet ones. Blocking on those would
    // stop exactly the seasonal campaigns this tool exists to speed up, so a
    // sitemap miss warns and asks for a human check instead.
    if (kind === "product" && !inv.products.has(tail))
      out.push({ level: "error", where: u.href, message: "no such product in the feed" });
    else if (kind === "collection" && inv.collections.size && !inv.collections.has(tail))
      out.push({
        level: "warn", where: u.href,
        message: "not in the current sitemap. Open it to confirm the collection is live.",
      });
    else if (kind === "search" && inv.searchPaths.size && !inv.searchPaths.has(tail))
      out.push({
        level: "warn", where: u.href,
        message: "not in the current sitemap. Often just an out-of-season category, but open it to confirm.",
      });
    else if (!["product", "collection", "search", "page", "blog"].includes(kind))
      out.push({ level: "warn", where: u.href, message: `unrecognised URL shape "/${kind}/"` });
  }

  // A CTA that promises one thing and links somewhere else is not detectable
  // from the URL alone, so surface the pairing for a human to eyeball.
  for (const b of c.blocks) {
    if (b.type !== "cta") continue;
    const words = b.label.toLowerCase().replace(/^shop\s+/, "").split(/\s+/).filter((w) => w.length > 3);
    const target = b.href.toLowerCase();
    if (words.length && !words.some((w) => target.includes(w.replace(/s$/, ""))))
      out.push({ level: "warn", where: b.label, message: `links to ${b.href}, confirm the destination matches the promise` });
  }

  return out;
}

export function report(findings: Finding[]): boolean {
  const errors = findings.filter((f) => f.level === "error");
  for (const f of findings)
    console.log(`  ${f.level === "error" ? "ERROR" : "warn "}  ${f.where}: ${f.message}`);
  if (!findings.length) console.log("  no findings");
  return errors.length === 0;
}
