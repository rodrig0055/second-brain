/**
 * Proof from other customers: written reviews and tagged photos.
 */
import { T } from "../tokens";
import { defineBlock, type BlockBase } from "./types";
import { FONT, esc, sectionTitle } from "./kit";

export type ReviewsBlock = BlockBase & {
  type: "reviews";
  title?: string;
  items: Array<{ quote: string; name: string }>;
};

export type IgTagsBlock = BlockBase & {
  type: "igTags";
  title?: string;
  href?: string;
  items: Array<{ image: string; handle: string; href?: string }>;
};

const stars = `<div style="color:${T.pink};font-size:15px;letter-spacing:2px">&#9733;&#9733;&#9733;&#9733;&#9733;</div>`;

export const reviewsDef = defineBlock<ReviewsBlock>({
  kind: "reviews",
  label: "Customer reviews",
  category: "commercial",
  blurb: "Real quotes with a first name. Nothing invented.",
  fields: [{ name: "title", label: "Title" }],
  items: {
    prop: "items",
    label: "Review",
    max: 6,
    fields: [
      { name: "quote", label: "Quote", kind: "long" },
      { name: "name", label: "Name" },
    ],
  },
  variants: [
    {
      id: "cards",
      label: "Cards",
      render: (b, ctx) => b.items.length === 0 ? [] : [ctx.row(`
        <div style="font-family:${FONT}">
          ${sectionTitle(ctx.ed("title", b.title ?? "What customers are saying"))}
          ${b.items.map((it) => `
          <div style="margin-top:14px;background:#ffffff;border-radius:12px;padding:14px 18px">
            <div style="font-size:15px;line-height:1.5;color:${T.navy}">&ldquo;${esc(it.quote)}&rdquo;</div>
            <div style="margin-top:6px;font-size:13px;font-weight:700;color:${T.pink}">${esc(it.name)}</div>
          </div>`).join("")}
        </div>`, T.blush, "30px 26px")],
    },
    {
      id: "stars",
      label: "Cards with stars",
      render: (b, ctx) => b.items.length === 0 ? [] : [ctx.row(`
        <div style="font-family:${FONT}">
          ${sectionTitle(ctx.ed("title", b.title ?? "What customers are saying"))}
          ${b.items.map((it) => `
          <div style="margin-top:14px;background:#ffffff;border-radius:12px;padding:16px 18px">
            ${stars}
            <div style="margin-top:8px;font-size:15px;line-height:1.5;color:${T.navy}">&ldquo;${esc(it.quote)}&rdquo;</div>
            <div style="margin-top:6px;font-size:13px;font-weight:700;color:${T.pink}">${esc(it.name)}</div>
          </div>`).join("")}
        </div>`, T.blush, "30px 26px")],
    },
    {
      id: "quote",
      label: "Single pull quote",
      blurb: "Only the first review, set large",
      render: (b, ctx) => {
        const it = b.items[0];
        if (!it) return [];
        return [ctx.row(`
          <div style="text-align:center;font-family:${FONT}">
            ${stars}
            <div style="margin-top:12px;font-size:21px;line-height:1.45;font-weight:700;color:${T.navy}">&ldquo;${esc(it.quote)}&rdquo;</div>
            <div style="margin-top:10px;font-size:13px;font-weight:700;letter-spacing:1px;color:${T.pink};text-transform:uppercase">${esc(it.name)}</div>
          </div>`, T.blush, "34px 30px")];
      },
    },
  ],
  empty: () => ({ type: "reviews", title: "What customers are saying", items: [] }),
});

export const igTagsDef = defineBlock<IgTagsBlock>({
  kind: "igTags",
  label: "Customer photos",
  category: "engagement",
  blurb: "Tagged Instagram photos with the handle credited. Get permission first.",
  fields: [
    { name: "title", label: "Title" },
    { name: "href", label: "Profile link", kind: "url", inline: false },
  ],
  items: {
    prop: "items",
    label: "Photo",
    max: 6,
    fields: [
      { name: "image", label: "Image URL", kind: "url", inline: false },
      { name: "handle", label: "Handle", hint: "Without the @" },
      { name: "href", label: "Post link", kind: "url", inline: false },
    ],
  },
  variants: [
    {
      id: "grid",
      label: "Photo grid",
      render: (b, ctx) => {
        const n = b.items.length;
        // Tagged photos need permission, so an empty block is the normal state.
        if (n === 0) return [];
        const cols = n % 3 === 0 ? 3 : 2;
        const pct = `${(100 / cols).toFixed(4)}%`;
        const rows = [ctx.row(sectionTitle(ctx.ed("title", b.title ?? "Tagged by you")), T.lavender, "26px 26px 8px")];
        for (let i = 0; i < n; i += cols) {
          rows.push(ctx.row(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              ${b.items.slice(i, i + cols).map((it) => `
              <th class="col" width="${pct}" valign="top" style="width:${pct};font-weight:400;padding:6px">
                <a class="fx-tile" href="${it.href ?? b.href ?? ctx.home}" style="display:block;text-decoration:none">
                  <img class="fx-shot" src="${it.image}" alt="Photo by @${esc(it.handle)}" width="${cols === 3 ? 190 : 288}"
                    style="display:block;width:100%;height:auto;border-radius:12px;border:0;background:${T.tile}">
                  <div style="padding-top:7px;text-align:center;font-family:${FONT};font-size:12px;font-weight:700;color:${T.navy}">@${esc(it.handle)}</div>
                </a>
              </th>`).join("")}
            </tr></table>`, T.lavender, "0 20px"));
        }
        return rows;
      },
    },
    {
      id: "strip",
      label: "Row with caption",
      blurb: "One row, handles listed underneath",
      render: (b, ctx) => {
        if (b.items.length === 0) return [];
        const pct = `${(100 / b.items.length).toFixed(4)}%`;
        return [
          ctx.row(sectionTitle(ctx.ed("title", b.title ?? "Tagged by you")), T.lavender, "26px 26px 8px"),
          ctx.row(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              ${b.items.map((it) => `
              <th class="col" width="${pct}" valign="top" style="width:${pct};font-weight:400;padding:3px">
                <a class="fx-tile" href="${it.href ?? b.href ?? ctx.home}" style="display:block"><img class="fx-shot" src="${it.image}" alt="Photo by @${esc(it.handle)}"
                  width="180" style="display:block;width:100%;height:auto;border-radius:10px;border:0;background:${T.tile}"></a>
              </th>`).join("")}
            </tr></table>
            <div style="padding-top:10px;text-align:center;font-family:${FONT};font-size:12px;color:${T.navy}">
              ${b.items.map((it) => `@${esc(it.handle)}`).join(" &nbsp;&bull;&nbsp; ")}
            </div>`, T.lavender, "0 20px 18px"),
        ];
      },
    },
  ],
  empty: () => ({ type: "igTags", title: "Tagged by you", items: [] }),
  links: (b, ctx) => b.items.map((it) => ({ href: it.href ?? b.href ?? ctx.home, alt: `@${it.handle}`, width: 190 })),
  images: (b) => b.items.map((it) => it.image).filter(Boolean),
});
