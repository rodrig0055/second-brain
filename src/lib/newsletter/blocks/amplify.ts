/**
 * Category and occasion amplification.
 *
 * These point at collections and occasion searches rather than products, so
 * they keep earning after the featured products sell out. Collection and
 * occasion links together are a third of all clicks across the SG sends.
 * A tile with no image falls back to a typographic tile rather than a gap.
 */
import { T } from "../tokens";
import { defineBlock, type BlockBase, type RenderCtx } from "./types";
import { FONT, esc, sectionTitle, eyebrow } from "./kit";

type Tile = { label: string; href: string; image?: string; sub?: string };

export type CategoryBlock = BlockBase & { type: "category"; title?: string; items: Tile[] };
export type OccasionPushBlock = BlockBase & { type: "occasionPush"; title?: string; items: Tile[] };

const TILE_FIELDS = [
  { name: "label", label: "Label" },
  { name: "href", label: "Link", kind: "url" as const, inline: false },
  { name: "image", label: "Image URL", kind: "url" as const, inline: false },
];

/** A tile: the photo when supplied, a colour block with the label when not. */
function tile(t: Tile, pct: string, width: number, bg: string, showSub = false) {
  const body = t.image
    ? `<img class="fx-shot" src="${t.image}" alt="${esc(t.label)}" width="${width}" style="display:block;width:100%;height:auto;border-radius:14px;border:0;background:${T.tile}">`
    : `<div style="background:${bg};border-radius:14px;padding:34px 10px;text-align:center;font-family:${FONT};
         font-size:17px;font-weight:800;color:${T.navy}">${esc(t.label)}</div>`;
  return `
  <th class="col" width="${pct}" valign="top" style="width:${pct};font-weight:400;padding:6px">
    <a class="fx-tile" href="${t.href}" style="display:block;text-decoration:none">${body}</a>
    ${t.image ? `<div style="padding-top:8px;text-align:center;font-family:${FONT};font-size:14px;font-weight:800;color:${T.navy}">
      <a class="fx-link" href="${t.href}" style="color:${T.navy};text-decoration:none">${esc(t.label)}</a></div>` : ""}
    ${showSub && t.sub ? `<div style="padding-top:3px;text-align:center;font-family:${FONT};font-size:12px;color:${T.navy}">${esc(t.sub)}</div>` : ""}
  </th>`;
}

/** Tiles laid out in full rows, two or three across depending on the count. */
function tileRows(items: Tile[], ctx: RenderCtx, bg: string, showSub = false): string[] {
  const n = items.length;
  if (n === 0) return [];
  const cols = n % 3 === 0 ? 3 : 2;
  const width = cols === 3 ? 190 : 288;
  const pct = `${(100 / cols).toFixed(4)}%`;
  const out: string[] = [];
  for (let i = 0; i < n; i += cols) {
    const slice = items.slice(i, i + cols);
    out.push(ctx.row(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%"><tr>
        ${slice.map((t) => tile(t, pct, width, bg, showSub)).join("")}
      </tr></table>`, T.lavender, "0 20px"));
  }
  return out;
}

function titleRow(ctx: RenderCtx, title: string | undefined, brow?: string): string[] {
  if (!title) return [];
  return [ctx.row(
    `${brow ? eyebrow(brow) : ""}<div style="padding-top:${brow ? "7px" : "0"}">${sectionTitle(ctx.ed("title", title ?? ""))}</div>`,
    T.lavender, "26px 26px 4px")];
}

/** A text row of links, used by the "list" variants. No images required. */
function linkList(items: Tile[], ctx: RenderCtx): string[] {
  if (items.length === 0) return [];
  return [ctx.row(
    items.map((t) => `
      <a class="fx-link" href="${t.href}" style="display:block;padding:13px 4px;border-bottom:1px solid rgba(55,68,105,.14);
         font-family:${FONT};font-size:16px;font-weight:700;color:${T.navy};text-decoration:none">
        ${esc(t.label)}<span style="float:right;color:${T.pink}">&rsaquo;</span>
      </a>`).join(""),
    T.lavender, "4px 30px 18px")];
}

export const categoryDef = defineBlock<CategoryBlock>({
  kind: "category",
  label: "Category amplification",
  category: "commercial",
  blurb: "Collection tiles. Keeps earning after the featured products sell out.",
  fields: [{ name: "title", label: "Title" }],
  items: { prop: "items", label: "Category", fields: TILE_FIELDS, max: 6 },
  variants: [
    {
      id: "tiles",
      label: "Photo tiles",
      render: (b, ctx) => [...titleRow(ctx, b.title), ...tileRows(b.items, ctx, T.blush)],
    },
    {
      id: "colour",
      label: "Colour tiles",
      blurb: "Type on colour, no photography needed",
      render: (b, ctx) => [
        ...titleRow(ctx, b.title),
        ...tileRows(b.items.map((t) => ({ ...t, image: undefined })), ctx, T.blush),
      ],
    },
    {
      id: "list",
      label: "Link list",
      blurb: "Compact text rows",
      render: (b, ctx) => [...titleRow(ctx, b.title), ...linkList(b.items, ctx)],
    },
  ],
  empty: (ctx) => ({
    type: "category",
    title: "Shop by category",
    items: [
      { label: "Bouquets", href: `${ctx.home}/search/flower/bouquet` },
      { label: "Hampers", href: `${ctx.home}/search/gift/hamper` },
    ],
  }),
  links: (b) => b.items.map((t) => ({ href: t.href, alt: t.label, width: 290 })),
  images: (b) => b.items.map((t) => t.image ?? "").filter(Boolean),
});

export const occasionPushDef = defineBlock<OccasionPushBlock>({
  kind: "occasionPush",
  label: "Occasion amplification",
  category: "commercial",
  blurb: "Occasion-led tiles, beyond the four evergreen ones in the nav.",
  fields: [{ name: "title", label: "Title" }],
  items: { prop: "items", label: "Occasion", fields: [...TILE_FIELDS, { name: "sub", label: "Sub line" }], max: 6 },
  variants: [
    {
      id: "tiles",
      label: "Photo tiles",
      render: (b, ctx) => [...titleRow(ctx, b.title, "Shop the occasion"), ...tileRows(b.items, ctx, T.blush, true)],
    },
    {
      id: "spotlight",
      label: "Spotlight",
      blurb: "The first occasion full width, the rest as tiles",
      render: (b, ctx) => {
        const [lead, ...rest] = b.items;
        const rows = titleRow(ctx, b.title, "Shop the occasion");
        if (lead) {
          rows.push(ctx.row(`
            <a href="${lead.href}" style="display:block;text-decoration:none">
              ${lead.image ? `<img src="${lead.image}" alt="${esc(lead.label)}" width="560" style="display:block;width:100%;height:auto;border-radius:16px;border:0">` : ""}
              <div style="padding-top:12px;text-align:center;font-family:${FONT}">
                <div style="font-size:22px;font-weight:800;color:${T.navy}">${esc(lead.label)}</div>
                ${lead.sub ? `<div style="margin-top:5px;font-size:14px;color:${T.navy}">${esc(lead.sub)}</div>` : ""}
              </div>
            </a>`, T.lavender, "6px 26px 12px"));
        }
        return [...rows, ...tileRows(rest, ctx, T.blush, true)];
      },
    },
    {
      id: "list",
      label: "Link list",
      render: (b, ctx) => [...titleRow(ctx, b.title), ...linkList(b.items, ctx)],
    },
  ],
  empty: (ctx) => ({
    type: "occasionPush",
    title: "Shop by occasion",
    items: [
      { label: "Birthday", href: `${ctx.home}/search/occasions/birthday` },
      { label: "Anniversary", href: `${ctx.home}/search/occasions/anniversary` },
    ],
  }),
  links: (b) => b.items.map((t) => ({ href: t.href, alt: t.label, width: 290 })),
  images: (b) => b.items.map((t) => t.image ?? "").filter(Boolean),
});
