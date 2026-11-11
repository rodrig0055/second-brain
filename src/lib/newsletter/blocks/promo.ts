/**
 * Offer and reassurance: voucher codes, call to action, copy bands, and the
 * delivery promise strip.
 */
import { T } from "../tokens";
import { uspIcon } from "./kit";
import { defineBlock, type BlockBase, type RenderCtx } from "./types";
import { FONT, esc, makeButton, outlineButton } from "./kit";

export type PromoCodeBlock = BlockBase & {
  type: "promoCode";
  headline: string;
  code: string;
  terms: string;
  href?: string;
};

export type CtaBlock = BlockBase & { type: "cta"; label: string; href: string };

export type BandBlock = BlockBase & {
  type: "band";
  line1: string;
  line2?: string;
  sub?: string;
  href?: string;
  bg?: string;
};

type Promise_ = { label: string; sub?: string; image?: string };

export type DeadlineBlock = BlockBase & {
  type: "deadline";
  label?: string;
  headline: string;
  sub?: string;
  href?: string;
  /** A hosted per-open countdown image, if the team has one. */
  timerImage?: string;
};
export type UspBlock = BlockBase & { type: "usp"; items: Promise_[] };

export const promoCodeDef = defineBlock<PromoCodeBlock>({
  kind: "promoCode",
  label: "Voucher / promo code",
  category: "commercial",
  blurb: "A discount code with its terms. The code itself is live text, so it can be copied.",
  fields: [
    { name: "headline", label: "Headline" },
    { name: "code", label: "Code", kind: "code" },
    { name: "terms", label: "Terms" },
    { name: "href", label: "Link", kind: "url", inline: false },
  ],
  variants: [
    {
      id: "pill",
      label: "Pill",
      render: (b, ctx) => !b.code.trim() ? [] : [ctx.row(`
        <div style="text-align:center;font-family:${FONT}">
          ${b.headline || ctx.editable ? `<div style="font-size:25px;font-weight:800;color:${T.pink}">${ctx.ed("headline", b.headline)}</div>` : ""}
          <div style="margin:${b.headline ? "14px" : "0"} auto 0;display:inline-block;background:${T.pink};color:#fff;
             border-radius:28px;padding:12px 30px;font-size:19px;font-weight:700;letter-spacing:.5px">
             USE CODE: <b style="font-size:23px;font-weight:800">${ctx.ed("code", b.code)}</b></div>
          ${b.terms || ctx.editable ? `<div style="margin-top:13px;font-size:11px;font-weight:700;letter-spacing:.5px;color:${T.pink}">${ctx.ed("terms", b.terms)}</div>` : ""}
        </div>`, T.blush, "32px 26px")],
    },
    {
      id: "ticket",
      label: "Ticket",
      blurb: "Dashed voucher stub on white",
      render: (b, ctx) => !b.code.trim() ? [] : [ctx.row(`
        <div style="background:#ffffff;border:2px dashed ${T.pink};border-radius:16px;padding:24px 20px;text-align:center;font-family:${FONT}">
          ${b.headline || ctx.editable ? `<div style="font-size:15px;font-weight:700;letter-spacing:1px;color:${T.navy};text-transform:uppercase">${ctx.ed("headline", b.headline)}</div>` : ""}
          <div style="margin-top:10px;font-size:34px;font-weight:800;letter-spacing:4px;color:${T.pink}">${ctx.ed("code", b.code)}</div>
          ${b.terms || ctx.editable ? `<div style="margin-top:10px;font-size:11px;font-weight:600;color:#8b93ad">${ctx.ed("terms", b.terms)}</div>` : ""}
        </div>`, T.blush, "26px 26px")],
    },
    {
      id: "slab",
      label: "Slab",
      blurb: "Full-bleed pink. Hard to miss.",
      render: (b, ctx) => !b.code.trim() ? [] : [ctx.row(`
        <div style="text-align:center;font-family:${FONT};color:#ffffff">
          ${b.headline || ctx.editable ? `<div style="font-size:27px;font-weight:800;line-height:1.15">${ctx.ed("headline", b.headline)}</div>` : ""}
          <div style="margin-top:12px;display:inline-block;background:#ffffff;color:${T.pink};border-radius:10px;
             padding:11px 26px;font-size:24px;font-weight:800;letter-spacing:3px">${ctx.ed("code", b.code)}</div>
          ${b.terms || ctx.editable ? `<div style="margin-top:12px;font-size:11px;font-weight:600;opacity:.9">${ctx.ed("terms", b.terms)}</div>` : ""}
        </div>`, T.pink, "32px 26px")],
    },
  ],
  empty: () => ({ type: "promoCode", headline: "", code: "", terms: "" }),
  links: (b, ctx) => [{ href: b.href || ctx.home, alt: `${b.headline}. Use code ${b.code}`, width: 600 }],
});

export const ctaDef = defineBlock<CtaBlock>({
  kind: "cta",
  label: "Button",
  category: "commercial",
  blurb: "One call to action. Clickable in Outlook via a VML fallback.",
  fields: [
    { name: "label", label: "Label" },
    { name: "href", label: "Link", kind: "url", inline: false },
  ],
  variants: [
    { id: "solid", label: "Solid", render: (b, ctx) => [ctx.row(ctx.button(b.label, b.href, ctx.ed("label", b.label)), T.lavender, "20px 0 30px")] },
    { id: "outline", label: "Outline", render: (b, ctx) => [ctx.row(outlineButton(b.label, b.href, ctx.ed("label", b.label)), T.lavender, "20px 0 30px")] },
    {
      id: "pink",
      label: "Pink",
      render: (b, ctx) => [ctx.row(makeButton(b.label, b.href, ctx.ed("label", b.label), T.pink), T.lavender, "20px 0 30px")],
    },
    {
      id: "link",
      label: "Text link",
      blurb: "Quiet. For a secondary action under a louder one.",
      render: (b, ctx) => [ctx.row(
        `<div style="text-align:center;font-family:${FONT}"><a href="${b.href}" style="color:${T.navy};font-size:14px;
          font-weight:800;letter-spacing:1px;text-decoration:underline">${ctx.ed("label", b.label)}</a></div>`,
        T.lavender, "6px 0 26px")],
    },
  ],
  empty: (ctx) => ({ type: "cta", label: "Shop now", href: ctx.home }),
  links: (b) => [{ href: b.href, alt: b.label, width: 600 }],
});

export const bandDef = defineBlock<BandBlock>({
  kind: "band",
  label: "Copy band",
  category: "commercial",
  blurb: "A headline and a line of copy. The connective tissue between sections.",
  fields: [
    { name: "line1", label: "Line 1" },
    { name: "line2", label: "Line 2", hint: "Shown in pink" },
    { name: "sub", label: "Sub copy" },
    { name: "href", label: "Link", kind: "url", inline: false },
  ],
  variants: [
    {
      id: "centered",
      label: "Centred",
      render: (b, ctx) => [ctx.row(bandBody(b, ctx, "center"), b.bg ?? T.lavender, "30px 34px 18px")],
    },
    {
      id: "left",
      label: "Left aligned",
      render: (b, ctx) => [ctx.row(bandBody(b, ctx, "left"), b.bg ?? T.lavender, "28px 30px 16px")],
    },
    {
      id: "rule",
      label: "With rule",
      blurb: "A hairline above, to open a new section",
      render: (b, ctx) => [ctx.row(
        `<div style="border-top:1px solid rgba(55,68,105,.18);padding-top:22px">${bandBody(b, ctx, "center")}</div>`,
        b.bg ?? T.lavender, "18px 34px 16px")],
    },
    {
      id: "section-bar",
      label: "Section bar",
      blurb: "A tinted full-width bar. Marks where a new section starts in a long send.",
      render: (b, ctx) => [ctx.row(
        `<div style="text-align:center;font-family:${FONT}">
          <div style="font-size:21px;line-height:1.25;font-weight:800;color:${T.navy}">${ctx.ed("line1", b.line1)}</div>
          ${b.sub || ctx.editable ? `<div style="margin-top:5px;font-size:13px;line-height:1.45;color:${T.navy};opacity:.8">${ctx.ed("sub", b.sub ?? "")}</div>` : ""}
        </div>`,
        T.blush, "16px 26px")],
    },
    {
      id: "blush",
      label: "On blush",
      render: (b, ctx) => [ctx.row(bandBody(b, ctx, "center"), T.blush, "30px 34px 24px")],
    },
  ],
  empty: () => ({ type: "band", line1: "New headline" }),
  links: (b) => [{ href: b.href ?? "", alt: [b.line1, b.line2].filter(Boolean).join(" "), width: 600 }],
});

function bandBody(b: BandBlock, ctx: RenderCtx, align: string) {
  return `
  <div style="text-align:${align};font-family:${FONT}">
    <div style="font-size:28px;line-height:1.2;font-weight:800;color:${T.navy}">${ctx.ed("line1", b.line1)}</div>
    ${b.line2 || ctx.editable ? `<div style="font-size:28px;line-height:1.2;font-weight:800;color:${T.pink}">${ctx.ed("line2", b.line2 ?? "")}</div>` : ""}
    ${b.sub || ctx.editable ? `<div style="margin-top:11px;font-size:15px;line-height:1.55;color:${T.navy}">${ctx.ed("sub", b.sub ?? "")}</div>` : ""}
  </div>`;
}

export const uspDef = defineBlock<UspBlock>({
  kind: "usp",
  label: "Delivery promise",
  category: "commercial",
  blurb: "Nationwide delivery, same-day cutoff, free card. The reassurance strip.",
  fields: [],
  items: {
    prop: "items",
    label: "Promise",
    max: 4,
    fields: [
      { name: "label", label: "Label" },
      { name: "sub", label: "Sub line" },
      { name: "image", label: "Icon", hint: "van, clock, card, leaf, gift, or an image URL", inline: false },
    ],
  },
  variants: [
    {
      id: "columns",
      label: "Columns",
      render: (b, ctx) => {
        if (b.items.length === 0) return [];
        const pct = `${(100 / b.items.length).toFixed(4)}%`;
        return [ctx.row(
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            ${b.items.map((p) => `
            <th class="col" width="${pct}" valign="top" style="width:${pct};font-weight:400;padding:0 8px">
              ${uspIcon(p.image, ctx.assetBase)
                ? `<img src="${uspIcon(p.image, ctx.assetBase)}" alt="" width="34" style="display:block;margin:0 auto 9px;width:34px;height:34px;border:0">` : ""}
              <div style="text-align:center;font-family:${FONT};font-size:13px;font-weight:800;color:${T.navy};line-height:1.3">${esc(p.label)}</div>
              ${p.sub ? `<div style="text-align:center;font-family:${FONT};font-size:11px;color:#8b93ad;padding-top:3px;line-height:1.35">${esc(p.sub)}</div>` : ""}
            </th>`).join("")}
          </tr></table>`, T.white, "20px 20px")];
      },
    },
    {
      id: "bar",
      label: "Single bar",
      blurb: "One navy strip, labels separated by dots",
      render: (b, ctx) => b.items.length === 0 ? [] : [ctx.row(
        `<div style="text-align:center;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1px;color:#ffffff">
          ${b.items.map((p) => esc(p.label)).join(' <span style="opacity:.5">&bull;</span> ')}
        </div>`, T.navy, "13px 18px")],
    },
    {
      id: "stacked",
      label: "Stacked rows",
      render: (b, ctx) => b.items.length === 0 ? [] : [ctx.row(
        b.items.map((p) => `
          <div style="padding:9px 0;font-family:${FONT};text-align:center">
            <span style="font-size:14px;font-weight:800;color:${T.navy}">${esc(p.label)}</span>
            ${p.sub ? `<span style="font-size:13px;color:#8b93ad"> &bull; ${esc(p.sub)}</span>` : ""}
          </div>`).join(""),
        T.white, "16px 20px")],
    },
  ],
  empty: () => ({
    type: "usp",
    items: [
      { label: "Nationwide delivery", sub: "Every address we reach", image: "van" },
      { label: "Same-day available", sub: "Order before the cutoff", image: "clock" },
      { label: "Free greeting card", sub: "Written in your words", image: "card" },
    ],
  }),
  // Named glyphs are committed assets, not URLs the validator should check.
  images: (b) => b.items.map((p) => p.image ?? "").filter((v) => /^https?:/.test(v)),
});

export const deadlineDef = defineBlock<DeadlineBlock>({
  kind: "deadline",
  label: "Deadline",
  category: "commercial",
  blurb: "The urgency line on a dated sale. States when it ends, in words.",
  fields: [
    { name: "label", label: "Label", hint: 'e.g. "OFFER ENDS"' },
    { name: "headline", label: "Deadline", hint: 'e.g. "Tonight at 11:59pm"' },
    { name: "sub", label: "Sub copy" },
    { name: "href", label: "Link", kind: "url", inline: false },
    { name: "timerImage", label: "Countdown image URL", kind: "url", inline: false,
      hint: "Optional, from a hosted timer service" },
  ],
  /**
   * No fake clock.
   *
   * The reference templates draw a ticking countdown, but a countdown baked
   * into the HTML is a still picture: it says 08:45:30 forever, including to
   * the person who opens the mail the next morning, and to Apple Mail Privacy
   * Protection, which pre-fetches every image on delivery. Since roughly 60% of
   * these opens are Apple proxies, most "views" of such a timer happen before a
   * human has looked at all.
   *
   * So the deadline is stated in words, which is true whenever it is read. A
   * real per-open countdown needs an image rendered per request by a hosted
   * timer service; paste that URL into `timerImage` and it appears above the
   * words, which stay as the fallback for every client that blocks images.
   */
  variants: [
    {
      id: "bar",
      label: "Bar",
      blurb: "A thin pink strip. Sits under the hero without stealing from it.",
      render: (b, ctx) => !b.headline.trim() ? [] : [ctx.row(
        `<div style="text-align:center;font-family:${FONT};color:#ffffff">
          ${b.label || ctx.editable ? `<span style="font-size:11px;font-weight:800;letter-spacing:2px;text-transform:uppercase;opacity:.9">${ctx.ed("label", b.label ?? "")}</span> ` : ""}
          <span style="font-size:15px;font-weight:800;letter-spacing:.3px">${ctx.ed("headline", b.headline)}</span>
        </div>`, T.pink, "13px 20px")],
    },
    {
      id: "panel",
      label: "Panel",
      render: (b, ctx) => !b.headline.trim() ? [] : [ctx.row(
        `<div style="text-align:center;font-family:${FONT}">
          ${b.label || ctx.editable ? `<div style="font-size:12px;font-weight:800;letter-spacing:2.5px;color:${T.pink};text-transform:uppercase">${ctx.ed("label", b.label ?? "")}</div>` : ""}
          ${b.timerImage ? `<img src="${b.timerImage}" alt="${esc(b.headline)}" width="300"
            style="display:block;margin:12px auto 0;max-width:300px;height:auto;border:0">` : ""}
          <div style="margin-top:10px;font-size:28px;line-height:1.15;font-weight:800;color:${T.navy}">${ctx.ed("headline", b.headline)}</div>
          ${b.sub || ctx.editable ? `<div style="margin-top:9px;font-size:15px;line-height:1.5;color:${T.navy}">${ctx.ed("sub", b.sub ?? "")}</div>` : ""}
        </div>`, T.blush, "28px 26px")],
    },
    {
      id: "stamp",
      label: "Stamp",
      blurb: "Outlined box on the page ground",
      render: (b, ctx) => !b.headline.trim() ? [] : [ctx.row(
        `<div style="border:2px solid ${T.pink};border-radius:14px;padding:20px 18px;text-align:center;font-family:${FONT}">
          ${b.label || ctx.editable ? `<div style="font-size:11px;font-weight:800;letter-spacing:2.5px;color:${T.pink};text-transform:uppercase">${ctx.ed("label", b.label ?? "")}</div>` : ""}
          <div style="margin-top:8px;font-size:22px;line-height:1.2;font-weight:800;color:${T.navy}">${ctx.ed("headline", b.headline)}</div>
          ${b.sub || ctx.editable ? `<div style="margin-top:7px;font-size:14px;line-height:1.45;color:${T.navy}">${ctx.ed("sub", b.sub ?? "")}</div>` : ""}
        </div>`, T.lavender, "20px 26px")],
    },
  ],
  empty: () => ({
    type: "deadline",
    label: "Offer ends",
    headline: "Tonight at 11:59pm",
    sub: "Order before the cutoff and it still arrives today.",
  }),
  links: (b) => (b.href ? [{ href: b.href, alt: b.headline, width: 600 }] : []),
  images: (b) => (b.timerImage ? [b.timerImage] : []),
});
