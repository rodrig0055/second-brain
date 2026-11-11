/**
 * The commercial core: product amplification, new arrivals, offer of the day.
 *
 * Products are always referenced by their catalog title, never by a URL typed
 * into the block, so a renamed or delisted product surfaces in the checks panel
 * instead of shipping as a dead tile. Product clicks are 47% of all clicks.
 */
import { T, priceParts } from "../tokens";
import { defineBlock, type BlockBase } from "./types";
import { FONT, esc, productRows, sectionTitle, eyebrow, makeButton } from "./kit";

export type ProductGridBlock = BlockBase & {
  type: "productGrid";
  columns: 2 | 3;
  products: string[];
  title?: string;
  eyebrow?: string;
};

export type NewArrivalsBlock = BlockBase & {
  type: "newArrivals";
  columns: 2 | 3;
  products: string[];
  title?: string;
  eyebrow?: string;
};

export type FeatureBlock = BlockBase & {
  type: "feature";
  product: string;
  note?: string;
  label?: string;
  endsAt?: string;
};

/** Heading rows shared by the titled grids. Emitted only when set. */
function headingRows(
  ctx: import("./types").RenderCtx,
  title: string | undefined,
  brow: string | undefined,
): string[] {
  if (!title && !brow && !ctx.editable) return [];
  return [ctx.row(
    `${brow || ctx.editable ? eyebrow(ctx.ed("eyebrow", brow ?? "")) : ""}
     ${title || ctx.editable ? `<div style="padding-top:${brow ? "7px" : "0"}">${sectionTitle(ctx.ed("title", title ?? ""))}</div>` : ""}`,
    T.lavender, "24px 26px 6px")];
}

export const productGridDef = defineBlock<ProductGridBlock>({
  kind: "productGrid",
  label: "Product amplification",
  category: "commercial",
  blurb: "A grid of products from the live feed. Rows must be full: 2, 3, 4 or 6.",
  productSlots: "grid",
  fields: [
    { name: "eyebrow", label: "Eyebrow" },
    { name: "title", label: "Title" },
  ],
  variants: [
    {
      id: "grid",
      label: "Bordered tiles",
      blurb: "The shipped look: pink border, name, price",
      render: (b, ctx) => [...headingRows(ctx, b.title, b.eyebrow), ...productRows(b.products, b.columns, ctx)],
    },
    {
      id: "cards",
      label: "White cards",
      render: (b, ctx) => [...headingRows(ctx, b.title, b.eyebrow), ...productRows(b.products, b.columns, ctx, { card: true })],
    },
    {
      id: "buttons",
      label: "Tiles with a button",
      blurb: "A button under every product. Products are most of what gets clicked.",
      render: (b, ctx) => [
        ...headingRows(ctx, b.title, b.eyebrow),
        ...productRows(b.products, b.columns, ctx, { button: "SHOP NOW" }),
      ],
    },
    {
      id: "clean",
      label: "No price",
      blurb: "Photo and name only. Use when prices vary by variant.",
      render: (b, ctx) => [...headingRows(ctx, b.title, b.eyebrow), ...productRows(b.products, b.columns, ctx, { hidePrice: true })],
    },
  ],
  empty: () => ({ type: "productGrid", columns: 3, products: [] }),
  products: (b) => b.products,
  links: (b, ctx) => b.products.map((name) => {
    const p = ctx.catalog.get(name) ?? null;
    return {
      href: p?.link ?? "",
      alt: p ? `${p.title} - ${priceParts(p).now}` : name,
      width: b.columns === 3 ? 200 : 300,
      row: `grid${b.columns}`,
    };
  }),
});

export const newArrivalsDef = defineBlock<NewArrivalsBlock>({
  kind: "newArrivals",
  label: "New arrivals",
  category: "commercial",
  blurb: "A grid flagged as new. Same feed rules as product amplification.",
  productSlots: "grid",
  fields: [
    { name: "eyebrow", label: "Eyebrow" },
    { name: "title", label: "Title" },
  ],
  variants: [
    {
      id: "ribbon",
      label: "NEW ribbon",
      render: (b, ctx) => [
        ...headingRows(ctx, b.title ?? "Just landed", b.eyebrow ?? "New arrivals"),
        ...productRows(b.products, b.columns, ctx, { ribbon: "NEW" }),
      ],
    },
    {
      id: "banner",
      label: "Banner strip",
      blurb: "A full-width pink strip instead of per-tile ribbons",
      render: (b, ctx) => [
        ctx.row(`<div style="text-align:center;font-family:${FONT};font-size:14px;font-weight:800;
          letter-spacing:3px;color:#ffffff;text-transform:uppercase">${ctx.ed("title", b.title ?? "New arrivals")}</div>`,
          T.pink, "13px 20px"),
        ...productRows(b.products, b.columns, ctx),
      ],
    },
  ],
  empty: () => ({ type: "newArrivals", columns: 3, products: [], title: "Just landed", eyebrow: "New arrivals" }),
  products: (b) => b.products,
  links: (b, ctx) => b.products.map((name) => {
    const p = ctx.catalog.get(name) ?? null;
    return {
      href: p?.link ?? "",
      alt: p ? `${p.title} - ${priceParts(p).now}` : name,
      width: b.columns === 3 ? 200 : 300,
      row: `grid${b.columns}`,
    };
  }),
});

export const featureDef = defineBlock<FeatureBlock>({
  kind: "feature",
  label: "Offer of the day",
  category: "commercial",
  blurb: "One product, full width. The flash-price treatment. A grid of one is never valid.",
  productSlots: "single",
  fields: [
    { name: "label", label: "Label", hint: 'e.g. "OFFER OF THE DAY"' },
    { name: "note", label: "Note", hint: "Line under the price" },
    { name: "endsAt", label: "Ends", hint: 'e.g. "Today only, until 11:59pm"' },
  ],
  variants: [
    {
      id: "portrait",
      label: "Portrait",
      render: (b, ctx) => {
        if (!b.product.trim()) return [];
        const p = ctx.catalog.get(b.product) ?? null;
        const href = p?.link ?? ctx.home;
        const src = ctx.imgs.get(b.product) ?? p?.imageLink ?? "";
        const { now, was } = p ? priceParts(p) : { now: "", was: null };
        return [ctx.row(`
          ${b.label || ctx.editable ? `<div style="padding-bottom:10px">${eyebrow(ctx.ed("label", b.label ?? ""))}</div>` : ""}
          <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;width:100%;max-width:400px"><tr><td style="padding:0">
            <a class="fx-tile" href="${href}" style="text-decoration:none;display:block">
              <img class="fx-shot" src="${src}" alt="${esc(p?.title ?? b.product)}" width="400" style="display:block;width:100%;height:auto;border:3px solid ${T.pink};border-radius:16px;background:${T.tile}">
            </a>
            <div style="text-align:center;padding-top:12px;font-family:${FONT};line-height:1.35">
              <a class="fx-link" href="${href}" style="color:${T.navy};font-weight:700;font-size:16px;text-decoration:underline">${esc(p?.title ?? b.product)}</a>
              ${now ? `<div style="margin-top:4px;font-size:16px">
                <span style="color:${T.pink};font-weight:800">${now}</span>
                ${was ? `<span style="margin-left:7px;color:#8b93ad;font-weight:600;text-decoration:line-through">${was}</span>` : ""}
              </div>` : ""}
              ${b.note || ctx.editable ? `<div style="margin-top:4px;color:${T.navy};font-size:13px">${ctx.ed("note", b.note ?? "")}</div>` : ""}
              ${b.endsAt || ctx.editable ? `<div style="margin-top:6px;color:${T.pink};font-size:12px;font-weight:700;letter-spacing:1px">${ctx.ed("endsAt", b.endsAt ?? "")}</div>` : ""}
            </div>
          </td></tr></table>`, T.lavender, "6px 26px 10px")];
      },
    },
    {
      id: "landscape",
      label: "Landscape",
      blurb: "Photo beside the price and a button",
      render: (b, ctx) => {
        if (!b.product.trim()) return [];
        const p = ctx.catalog.get(b.product) ?? null;
        const href = p?.link ?? ctx.home;
        const src = ctx.imgs.get(b.product) ?? p?.imageLink ?? "";
        const { now, was } = p ? priceParts(p) : { now: "", was: null };
        return [ctx.row(`
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <th class="col" width="46%" valign="middle" style="width:46%;font-weight:400;padding:0 10px 0 0">
              <a class="fx-tile" href="${href}" style="display:block;text-decoration:none"><img class="fx-shot" src="${src}" alt="${esc(p?.title ?? b.product)}" width="260"
                style="display:block;width:100%;height:auto;border-radius:14px;border:0;background:${T.tile}"></a>
            </th>
            <th class="col" width="54%" valign="middle" style="width:54%;font-weight:400;padding:0 0 0 10px">
              <div style="text-align:left;font-family:${FONT}">
                ${b.label || ctx.editable ? `<div style="font-size:11px;font-weight:800;letter-spacing:2px;color:${T.pink};text-transform:uppercase">${ctx.ed("label", b.label ?? "")}</div>` : ""}
                <a href="${href}" style="display:block;margin-top:6px;color:${T.navy};font-weight:800;font-size:19px;line-height:1.25;text-decoration:none">${esc(p?.title ?? b.product)}</a>
                ${now ? `<div style="margin-top:6px;font-size:22px">
                  <span style="color:${T.pink};font-weight:800">${now}</span>
                  ${was ? `<span style="margin-left:8px;color:#8b93ad;font-weight:600;font-size:16px;text-decoration:line-through">${was}</span>` : ""}
                </div>` : ""}
                ${b.note || ctx.editable ? `<div style="margin-top:6px;color:${T.navy};font-size:13px;line-height:1.45">${ctx.ed("note", b.note ?? "")}</div>` : ""}
                <div style="margin-top:12px"><a class="fx-btn" href="${href}" style="display:inline-block;background:${T.navy};color:#fff;border-radius:22px;
                  padding:11px 24px;font-size:13px;font-weight:800;letter-spacing:1px;text-decoration:none">SHOP NOW</a></div>
              </div>
            </th>
          </tr></table>`, T.lavender, "14px 26px 18px")];
      },
    },
    {
      id: "price-slab",
      label: "Price slab",
      blurb: "Loud price on blush. For a genuine flash price.",
      render: (b, ctx) => {
        if (!b.product.trim()) return [];
        const p = ctx.catalog.get(b.product) ?? null;
        const href = p?.link ?? ctx.home;
        const src = ctx.imgs.get(b.product) ?? p?.imageLink ?? "";
        const { now, was } = p ? priceParts(p) : { now: "", was: null };
        return [ctx.row(`
          <div style="text-align:center;font-family:${FONT}">
            ${b.label || ctx.editable ? `<div style="font-size:12px;font-weight:800;letter-spacing:3px;color:${T.pink};text-transform:uppercase">${ctx.ed("label", b.label ?? "")}</div>` : ""}
            ${now ? `<div style="margin-top:6px;line-height:1.05">
              <span style="color:${T.pink};font-weight:800;font-size:46px">${now}</span>
              ${was ? `<div style="margin-top:2px;color:#8b93ad;font-weight:600;font-size:17px;text-decoration:line-through">${was}</div>` : ""}
            </div>` : ""}
            <a href="${href}" style="display:block;margin-top:10px;color:${T.navy};font-weight:700;font-size:16px;text-decoration:underline">${esc(p?.title ?? b.product)}</a>
            ${b.endsAt || ctx.editable ? `<div style="margin-top:6px;color:${T.navy};font-size:12px;font-weight:700;letter-spacing:1px">${ctx.ed("endsAt", b.endsAt ?? "")}</div>` : ""}
            <a class="fx-tile" href="${href}" style="display:block;margin-top:14px;text-decoration:none">
              <img class="fx-shot" src="${src}" alt="${esc(p?.title ?? b.product)}" width="340" style="display:block;width:100%;max-width:340px;margin:0 auto;height:auto;border-radius:16px;border:0;background:${T.tile}">
            </a>
            <div style="margin-top:16px">${makeButton("GRAB IT NOW", href)}</div>
          </div>`, T.blush, "30px 26px")];
      },
    },
  ],
  empty: () => ({ type: "feature", product: "" }),
  products: (b) => (b.product ? [b.product] : []),
  links: (b, ctx) => {
    const p = ctx.catalog.get(b.product) ?? null;
    return [{ href: p?.link ?? "", alt: p ? `${p.title} - ${priceParts(p).now}` : b.product, width: 600 }];
  },
});
