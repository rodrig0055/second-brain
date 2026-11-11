/**
 * The campaign hero: the one piece of art generated per send, plus the headline
 * that carries the offer. The image comes from the campaign row (GPT Image 2.5),
 * not from the block, so a variant change never loses the art.
 */
import { T } from "../tokens";
import { defineBlock, type BlockBase, type RenderCtx } from "./types";
import { FONT, esc } from "./kit";

export type HeroBlock = BlockBase & {
  type: "hero";
  kicker?: string;
  badge?: string;
  headline: string;
  headlineAccent?: string;
  dates?: string;
  image?: string;
  href: string;
};

/**
 * The hero copy, staggered.
 *
 * The only animated part of the email. There is no scroll trigger in mail, so
 * anything lower has finished before a reader reaches it; the hero is the one
 * thing on screen when the message opens. The classes resolve to nothing if the
 * style block is stripped, so this is the same markup either way.
 */
const copyStack = (b: HeroBlock, ctx: RenderCtx, align = "center") => `
  <div style="text-align:${align};font-family:${FONT}">
    ${b.badge || ctx.editable ? `<div class="fx-rise fx-pulse" style="display:inline-block;background:${T.pink};color:#fff;font-size:20px;
       font-weight:800;letter-spacing:1px;padding:8px 20px;border-radius:8px">${ctx.ed("badge", b.badge ?? "")}</div>` : ""}
    ${b.dates || ctx.editable ? `<div class="fx-rise fx-d1" style="margin-top:12px;color:${T.pink};font-size:14px;font-weight:700;letter-spacing:2px">${ctx.ed("dates", b.dates ?? "")}</div>` : ""}
    <div class="fx-rise fx-d2" style="margin-top:8px;font-size:34px;line-height:1.15;font-weight:800;color:${T.navy}">
      ${ctx.ed("headline", b.headline)}<br><span style="color:${T.pink}">${ctx.ed("headlineAccent", b.headlineAccent ?? "")}</span>
    </div>
    ${b.kicker ? `<div class="fx-rise fx-d3" style="margin-top:12px"><span style="display:inline-block;background:${T.pink};color:#fff;border-radius:20px;padding:7px 16px;font-size:12px;font-weight:700;letter-spacing:1px">${esc(b.kicker)}</span></div>` : ""}
  </div>`;

const heroImg = (b: HeroBlock, src: string, width = 600, margin = "14px") =>
  src
    ? `<a class="fx-tile" href="${b.href}" style="display:block;text-decoration:none">
        <img class="fx-rise fx-d3" src="${src}" alt="${esc(b.headline)} ${esc(b.headlineAccent ?? "")}" width="${width}"
          style="display:block;width:100%;height:auto;margin-top:${margin};border:0">
      </a>`
    : "";

export const heroDef = defineBlock<HeroBlock>({
  kind: "hero",
  label: "Hero",
  category: "commercial",
  blurb: "The headline, the offer and the generated campaign art.",
  fields: [
    { name: "badge", label: "Badge" },
    { name: "dates", label: "Dates" },
    { name: "headline", label: "Headline" },
    { name: "headlineAccent", label: "Headline accent", hint: "Second line, shown in pink" },
    { name: "kicker", label: "Kicker pill" },
    { name: "href", label: "Link", kind: "url", inline: false },
  ],
  variants: [
    {
      id: "centered",
      label: "Copy over art",
      blurb: "The shipped look: headline stack, then the image",
      render: (b, ctx) => [ctx.row(
        `${copyStack(b, ctx)}${heroImg(b, ctx.heroUrl)}`,
        T.lavender, ctx.heroUrl ? "26px 20px 0" : "26px 20px 24px")],
    },
    {
      id: "image-first",
      label: "Art over copy",
      render: (b, ctx) => [ctx.row(
        `${heroImg(b, ctx.heroUrl, 600, "0")}<div style="padding-top:18px">${copyStack(b, ctx)}</div>`,
        T.lavender, ctx.heroUrl ? "0 0 22px" : "26px 20px 24px")],
    },
    {
      id: "split",
      label: "Split",
      blurb: "Art beside the copy, stacks on a phone",
      render: (b, ctx) => [ctx.row(
        ctx.heroUrl
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <th class="col" width="48%" valign="middle" style="width:48%;font-weight:400;padding:0 10px 0 0">
                ${heroImg(b, ctx.heroUrl, 280, "0")}
              </th>
              <th class="col" width="52%" valign="middle" style="width:52%;font-weight:400;padding:0 0 0 10px">
                ${copyStack(b, ctx, "left")}
              </th>
            </tr></table>`
          : copyStack(b, ctx),
        T.lavender, "24px 22px")],
    },
    {
      id: "text-only",
      label: "Type only",
      blurb: "No art. Use when the send leads with a promo code.",
      render: (b, ctx) => [ctx.row(copyStack(b, ctx), T.blush, "34px 24px")],
    },
  ],
  empty: (ctx) => ({ type: "hero", headline: "New headline", headlineAccent: "", href: ctx.home }),
  links: (b) => [{
    href: b.href,
    alt: `${b.badge ?? ""} ${b.headline} ${b.headlineAccent ?? ""}`.trim(),
    width: 600,
  }],
});
