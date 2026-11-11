/**
 * Shared email-HTML primitives.
 *
 * Every helper here has to survive Gmail, Outlook and Apple Mail: tables for
 * layout, inline styles only, no flexbox, no grid, no external CSS beyond the
 * webfont link that Gmail strips anyway.
 */
import { T, priceParts, type BrandAssets } from "../tokens";
import type { Catalog } from "../catalog";
import type { RenderCtx } from "./types";

export const FONT = `Poppins,'Segoe UI','Trebuchet MS',Arial,sans-serif`;

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function makeRow(inner: string, bg: string = T.lavender, pad = "0") {
  return `<tr><td bgcolor="${bg}" style="padding:${pad};background:${bg}">${inner}</td></tr>`;
}

/** Bulletproof button: VML for Outlook, padded anchor everywhere else. */
export function makeButton(label: string, href: string, labelHtml?: string, bg: string = T.navy) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center">
  <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
    href="${href}" style="height:46px;v-text-anchor:middle;width:260px" arcsize="52%" stroke="f" fillcolor="${bg}">
    <w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:bold;letter-spacing:1px">${esc(label)}</center>
  </v:roundrect><![endif]-->
  <!--[if !mso]><!-- -->
  <a class="fx-btn" href="${href}" style="background:${bg};border-radius:24px;color:#ffffff;display:inline-block;
     font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:1.1px;line-height:46px;
     text-align:center;text-decoration:none;width:260px;-webkit-text-size-adjust:none">${labelHtml ?? esc(label)}</a>
  <!--<![endif]-->
  </td></tr></table>`;
}

/** Outline variant of the same rectangle. Outlook gets the stroked roundrect. */
export function outlineButton(label: string, href: string, labelHtml?: string) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center">
  <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
    href="${href}" style="height:46px;v-text-anchor:middle;width:260px" arcsize="52%" strokecolor="${T.navy}" fillcolor="#ffffff">
    <w:anchorlock/><center style="color:${T.navy};font-family:Arial,sans-serif;font-size:15px;font-weight:bold;letter-spacing:1px">${esc(label)}</center>
  </v:roundrect><![endif]-->
  <!--[if !mso]><!-- -->
  <a class="fx-btn" href="${href}" style="background:#ffffff;border:2px solid ${T.navy};border-radius:24px;color:${T.navy};display:inline-block;
     font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:1.1px;line-height:42px;
     text-align:center;text-decoration:none;width:256px;-webkit-text-size-adjust:none">${labelHtml ?? esc(label)}</a>
  <!--<![endif]-->
  </td></tr></table>`;
}

export type TileOptions = {
  /** Corner ribbon text, e.g. "NEW". */
  ribbon?: string;
  /** Hide the price line. */
  hidePrice?: boolean;
  /** Card treatment: white panel behind the tile. */
  card?: boolean;
  /** Row background. Defaults to the page ground; set it when the block sits
   *  on blush, or the tiles land on a different colour from the block above. */
  bg?: string;
  /** A button under each tile, e.g. "SHOP NOW". Every reference template has
   *  one; ours had only the product name as a link, and products are 47% of
   *  all clicks. */
  button?: string;
};

/** One product tile inside a grid. `pct` is the column width. */
export function productCell(
  name: string,
  cat: Catalog,
  width: number,
  imgs: Map<string, string>,
  pct: string,
  home: string,
  o: TileOptions = {},
) {
  const p = cat.get(name) ?? null;
  const src = imgs.get(name) ?? p?.imageLink ?? "";
  const href = p?.link ?? home;
  const { now, was } = p ? priceParts(p) : { now: "", was: null };
  const oos = p && p.availability && p.availability !== "in stock";
  const inner = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td style="padding:0">
        <a class="fx-tile" href="${href}" style="text-decoration:none;display:block">
          <img class="fx-shot" src="${src}" alt="${esc(p?.title ?? name)}" width="${width - 12}"
            style="display:block;width:100%;height:auto;border:${o.card ? "0" : `2px solid ${T.pink}`};border-radius:12px;background:${T.tile}">
        </a>
      </td></tr>
      ${o.ribbon ? `<tr><td align="center" style="padding:7px 0 0">
        <span style="display:inline-block;background:${T.pink};color:#fff;font-family:${FONT};font-size:10px;
          font-weight:800;letter-spacing:1px;padding:4px 10px;border-radius:10px">${esc(o.ribbon)}</span>
      </td></tr>` : ""}
      <tr><td align="center" class="pname" style="padding:9px 2px 0;font-family:${FONT};font-size:13px;line-height:1.35">
        <a class="fx-link" href="${href}" style="color:${T.navy};font-weight:700;text-decoration:underline">${esc(p?.title ?? name)}</a>
        ${now && !o.hidePrice ? `<div style="margin-top:4px">
          <span style="color:${T.pink};font-weight:800">${now}</span>
          ${was ? `<span style="margin-left:6px;color:#8b93ad;font-weight:600;text-decoration:line-through">${was}</span>` : ""}
        </div>` : ""}
        ${oos ? `<div style="margin-top:2px;color:#8b93ad;font-size:11px">Currently unavailable</div>` : ""}
        ${o.button ? `<div style="margin-top:9px">
          <a class="fx-btn" href="${href}" style="display:inline-block;background:${T.navy};color:#ffffff;border-radius:16px;
            padding:7px 16px;font-size:11px;font-weight:800;letter-spacing:1px;text-decoration:none">${esc(o.button)}</a>
        </div>` : ""}
      </td></tr>
    </table>`;
  return `
  <th class="col" width="${pct}" valign="top" style="width:${pct};font-weight:400;padding:6px">
    ${o.card ? `<div style="background:#ffffff;border-radius:14px;padding:10px 10px 14px">${inner}</div>` : inner}
  </th>`;
}

/**
 * Lay products out in full rows.
 *
 * Percentage columns keep the desktop shape on a phone. A trailing partial row
 * falls back to fixed widths and centres, which only happens when the validator
 * has already flagged the count.
 */
export function productRows(
  products: string[],
  columns: 2 | 3,
  ctx: RenderCtx,
  o: TileOptions = {},
): string[] {
  const w = columns === 3 ? 200 : 300;
  const out: string[] = [];
  for (let i = 0; i < products.length; i += columns) {
    const slice = products.slice(i, i + columns);
    const isFull = slice.length === columns;
    const pct = isFull ? `${(100 / columns).toFixed(4)}%` : `${w}px`;
    const open = isFull
      ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%">`
      : `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">`;
    out.push(ctx.row(
      `${open}<tr>${slice.map((n) => productCell(n, ctx.catalog, w, ctx.imgs, pct, ctx.home, o)).join("")}</tr></table>`,
      o.bg ?? T.lavender, "0 6px",
    ));
  }
  return out;
}

/** Section heading used by the titled content blocks. */
export function sectionTitle(text: string, color: string = T.navy) {
  return `<div style="text-align:center;font-family:${FONT};font-size:24px;line-height:1.22;font-weight:800;color:${color}">${text}</div>`;
}

export function eyebrow(text: string, color: string = T.pink) {
  return `<div style="text-align:center;font-family:${FONT};font-size:12px;font-weight:800;letter-spacing:2.5px;color:${color};text-transform:uppercase">${text}</div>`;
}

/**
 * The brand lockup: the real slice, or nothing.
 *
 * There is no text version. A headline-weight rendering of the brand name is
 * not the logo, it just looks like a logo that failed to load, and shipping one
 * is worse than shipping no logo at all. A brand with no committed slice gets
 * an empty lockup and a check telling the marketer to supply it.
 */
export function lockup(brand: string, home: string, assets: BrandAssets | null) {
  if (!assets) return "";
  return `<a href="${home}" style="display:block;text-decoration:none"><img src="${assets.header}" alt="${esc(brand)}" width="600" style="display:block;width:100%;height:auto;border:0"></a>`;
}

/** Glyphs committed under public/newsletter/usp, addressable by name. */
const USP_GLYPHS = new Set(["van", "clock", "card", "leaf", "gift"]);

/**
 * Resolve a delivery-promise icon.
 *
 * A bare name ("van") becomes a committed glyph; anything starting http stays a
 * URL. The field used to be URL-only, which meant nobody ever filled it and the
 * strip shipped as bare text.
 */
export function uspIcon(value: string | undefined, assetBase: string): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (/^https?:/.test(v)) return v;
  if (!USP_GLYPHS.has(v.toLowerCase())) return "";
  return `${assetBase.replace(/\/+$/, "")}/newsletter/usp/${v.toLowerCase()}.png`;
}
