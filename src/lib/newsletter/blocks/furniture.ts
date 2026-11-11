/**
 * The frame: logo, occasion nav, footer.
 *
 * Furniture is present in every send and never moves. The nav in particular is
 * not decoration: across 71 SG sends the four evergreen occasion banners plus
 * the logo account for roughly 35% of all clicks, which is why it stays above
 * the fold in every template.
 */
import { T, occasions, socialLinks, type Network } from "../tokens";
import { defineBlock, type BlockBase, type RenderCtx } from "./types";
import { FONT, lockup } from "./kit";

export type HeaderBlock = BlockBase & { type: "header"; tagline?: string };
export type OccasionNavBlock = BlockBase & { type: "occasionNav" };
export type FooterBlock = BlockBase & {
  type: "footer";
  instagram?: string;
  facebook?: string;
  tiktok?: string;
};

export const headerDef = defineBlock<HeaderBlock>({
  kind: "header",
  label: "Header",
  category: "furniture",
  blurb: "The brand lockup at the top, linked to the storefront.",
  fields: [{ name: "tagline", label: "Tagline", hint: "Optional line under the logo" }],
  variants: [
    {
      id: "logo",
      label: "Logo",
      blurb: "The lockup on its own",
      render: (b, ctx) => ctx.assets
        ? [ctx.row(lockup(ctx.campaign.brand, ctx.home, ctx.assets), T.lavender, "0")]
        : [],
    },
    {
      id: "logo-tagline",
      label: "Logo with tagline",
      render: (b, ctx) => [ctx.row(
        `${lockup(ctx.campaign.brand, ctx.home, ctx.assets)}
         <div style="text-align:center;padding-top:${ctx.assets ? "8px" : "0"};font-family:${FONT};font-size:12px;font-weight:700;
            letter-spacing:2px;color:${T.pink};text-transform:uppercase">${ctx.ed("tagline", b.tagline ?? "")}</div>`,
        T.lavender, ctx.assets ? "0 0 10px" : "20px 0 14px")],
    },
  ],
  empty: () => ({ type: "header" }),
  links: (b, ctx) => [{ href: ctx.home, alt: `${ctx.campaign.brand} logo`, width: 600 }],
});

export const occasionNavDef = defineBlock<OccasionNavBlock>({
  kind: "occasionNav",
  label: "Occasion nav",
  category: "furniture",
  blurb: "The four evergreen occasion links. Around a fifth of all clicks.",
  fields: [],
  variants: [
    {
      id: "icons",
      label: "Icon tiles",
      render: (b, ctx) => [ctx.row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          ${occasions(ctx.campaign.domain).map((o) => `
          <th class="col" width="25%" style="width:25%;font-weight:400;padding:0">
            <a class="fx-nav" href="${o.href}" style="display:block;text-decoration:none">${
              ctx.assets
                ? `<img src="${ctx.assets.nav[o.slug]}" alt="Shop ${o.label} gifts" width="150" style="display:block;width:100%;height:auto;border:0">`
                : `<span style="display:block;text-align:center;padding:14px 0 18px;font-family:${FONT};font-size:13px;font-weight:700;color:${T.navy}">${o.label}</span>`
            }</a>
          </th>`).join("")}
        </tr></table>`, T.lavender, "0")],
    },
    {
      id: "pills",
      label: "Text pills",
      blurb: "No slices needed, works for every brand",
      render: (b, ctx) => [ctx.row(
        `<div style="text-align:center;font-family:${FONT}">
          ${occasions(ctx.campaign.domain).map((o) => `
          <a class="fx-nav" href="${o.href}" style="display:inline-block;margin:4px 3px;background:#ffffff;border:1px solid ${T.navy};
             border-radius:18px;padding:8px 15px;font-size:12px;font-weight:700;color:${T.navy};text-decoration:none">${o.label}</a>`).join("")}
        </div>`, T.lavender, "14px 16px 6px")],
    },
  ],
  empty: () => ({ type: "occasionNav" }),
  links: (b, ctx) =>
    occasions(ctx.campaign.domain).map((o) => ({ href: o.href, alt: `Shop ${o.label} gifts`, width: 150, row: "nav" })),
});

/**
 * The social row: always present, always icons.
 *
 * Words were wrong twice over. They read as ordinary links rather than as the
 * icons people scan a footer for, and they were behind a variant that the
 * templates never selected, so filling in the URLs appeared to do nothing at
 * all. The profiles now come from the brand by default and the row is part of
 * every footer design.
 *
 * PNGs, not inline SVG: Gmail strips SVG. Each icon keeps a real `alt`, so a
 * client with images off still shows "Instagram" as a working link.
 */
function socialRow(b: FooterBlock, ctx: RenderCtx): string {
  const overrides: Partial<Record<Network, string>> = {
    instagram: b.instagram,
    facebook: b.facebook,
    tiktok: b.tiktok,
  };
  const links = socialLinks(ctx.assetBase, ctx.campaign.domain, overrides);
  if (links.length === 0) return "";
  return `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
    <tr>${links.map((l) => `
      <td align="center" style="padding:0 9px">
        <a class="fx-nav" href="${l.href}" style="display:inline-block;text-decoration:none">
          <img src="${l.icon}" alt="${l.label}" width="26" height="26"
            style="display:block;width:26px;height:26px;border:0">
        </a>
      </td>`).join("")}
    </tr>
  </table>`;
}

export const footerDef = defineBlock<FooterBlock>({
  kind: "footer",
  label: "Footer",
  category: "furniture",
  blurb: "Social icons. The copyright and unsubscribe line is always added below.",
  fields: [
    // Blank means "use the brand's own profile"; these only override it.
    { name: "instagram", label: "Instagram", kind: "url", hint: "Overrides the brand profile", inline: false },
    { name: "facebook", label: "Facebook", kind: "url", hint: "Overrides the brand profile", inline: false },
    { name: "tiktok", label: "TikTok", kind: "url", hint: "Overrides the brand profile", inline: false },
  ],
  /**
   * One design, deliberately.
   *
   * The footer is socials and nothing else: the lockup already opens the email,
   * and repeating it at the bottom only pushes the unsubscribe line further
   * away. There is no variant to pick because there is no decision to make.
   */
  variants: [
    {
      id: "socials",
      label: "Social icons",
      render: (b, ctx) => {
        const social = socialRow(b, ctx);
        return social ? [ctx.row(social, T.lavender, "18px 30px 16px")] : [];
      },
    },
  ],
  empty: () => ({ type: "footer" }),
  // Declared, not just rendered: an undeclared link is invisible to the
  // validator and cannot be attributed when the click data comes back.
  links: (b, ctx) =>
    socialLinks(ctx.assetBase, ctx.campaign.domain, {
      instagram: b.instagram, facebook: b.facebook, tiktok: b.tiktok,
    }).map((l) => ({ href: l.href, alt: l.label, width: 26 })),
});
