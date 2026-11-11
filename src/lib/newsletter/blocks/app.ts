/**
 * The app push. Store badges are plain styled anchors rather than the official
 * badge images, because those are hosted on domains that some corporate mail
 * gateways block, and a missing badge image reads as a broken email.
 */
import { T, appLinks, storeBadge } from "../tokens";
import { defineBlock, type BlockBase, type RenderCtx } from "./types";
import { FONT, esc, eyebrow } from "./kit";

export type AppPromoBlock = BlockBase & {
  type: "appPromo";
  headline: string;
  body: string;
  /** Overrides for the brand's own listing; blank uses the brand. */
  iosHref?: string;
  androidHref?: string;
  image?: string;
  feature?: string;
};

/**
 * The official store badges.
 *
 * These were styled text links reading "DOWNLOAD IOS", which is not how anyone
 * expects to get an app. Apple and Google publish badge artwork for exactly
 * this purpose, so these are the real assets rather than an approximation:
 * Apple's SVG rasterised (Gmail strips inline SVG) and Google's PNG trimmed of
 * its baked-in clear space so the two match at a shared height.
 *
 * The URLs come from the brand, not from whoever is writing the campaign. The
 * Apple link carries no region on purpose: it redirects to the reader's own
 * store, which matters when one send crosses SG, PH, VN and TH.
 */
function storeLinks(b: AppPromoBlock, ctx: RenderCtx): string {
  const { ios, android } = appLinks(ctx.campaign.domain, { ios: b.iosHref, android: b.androidHref });
  const badge = (href: string, store: "ios" | "android", label: string, w: number) =>
    href
      ? `<a class="fx-btn" href="${href}" style="display:inline-block;text-decoration:none;margin:4px 5px">
          <img src="${storeBadge(ctx.assetBase, store)}" alt="${label}" width="${w}" height="40"
            style="display:block;width:${w}px;height:40px;border:0">
        </a>`
      : "";
  // Widths are the artwork's own proportions at a 40px height, so neither badge
  // is squashed to match the other.
  return `${badge(ios, "ios", "Download on the App Store", 120)}${badge(android, "android", "Get it on Google Play", 134)}`;
}

export const appPromoDef = defineBlock<AppPromoBlock>({
  kind: "appPromo",
  label: "App feature push",
  category: "commercial",
  blurb: "One app feature and the two store links.",
  fields: [
    { name: "feature", label: "Feature label", hint: 'e.g. "NEW IN THE APP"' },
    { name: "headline", label: "Headline" },
    { name: "body", label: "Body", kind: "long" },
    // Blank means "use the brand's own listing"; these only override it.
    { name: "iosHref", label: "iOS link", kind: "url", hint: "Overrides the brand listing", inline: false },
    { name: "androidHref", label: "Android link", kind: "url", hint: "Overrides the brand listing", inline: false },
    { name: "image", label: "Screenshot URL", kind: "url", inline: false },
  ],
  variants: [
    {
      id: "card",
      label: "Outlined card",
      render: (b, ctx) => [ctx.row(`
        <div style="border:2px solid ${T.navy};border-radius:22px;padding:26px 24px;text-align:center;font-family:${FONT};background:#ffffff">
          ${b.feature || ctx.editable ? `<div style="padding-bottom:8px">${eyebrow(ctx.ed("feature", b.feature ?? ""))}</div>` : ""}
          <div style="font-size:24px;line-height:1.2;font-weight:800;color:${T.navy}">${ctx.ed("headline", b.headline)}</div>
          <div style="margin-top:10px;font-size:15px;line-height:1.5;color:${T.navy}">${ctx.ed("body", b.body)}</div>
          <div style="margin-top:16px">${storeLinks(b, ctx)}</div>
        </div>`, T.lavender, "22px 26px 30px")],
    },
    {
      id: "split",
      label: "With screenshot",
      render: (b, ctx) => [ctx.row(`
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          ${b.image ? `<th class="col" width="38%" valign="middle" style="width:38%;font-weight:400;padding:0 12px 0 0">
            <img src="${b.image}" alt="${esc(b.headline)}" width="200" style="display:block;width:100%;height:auto;border-radius:16px;border:0">
          </th>` : ""}
          <th class="col" width="${b.image ? "62%" : "100%"}" valign="middle" style="width:${b.image ? "62%" : "100%"};font-weight:400;padding:0">
            <div style="text-align:left;font-family:${FONT}">
              ${b.feature || ctx.editable ? `<div style="font-size:11px;font-weight:800;letter-spacing:2px;color:${T.pink};text-transform:uppercase">${ctx.ed("feature", b.feature ?? "")}</div>` : ""}
              <div style="margin-top:6px;font-size:21px;line-height:1.22;font-weight:800;color:${T.navy}">${ctx.ed("headline", b.headline)}</div>
              <div style="margin-top:8px;font-size:14px;line-height:1.5;color:${T.navy}">${ctx.ed("body", b.body)}</div>
              <div style="margin-top:14px">${storeLinks(b, ctx)}</div>
            </div>
          </th>
        </tr></table>`, T.lavender, "24px 26px 28px")],
    },
    {
      id: "banner",
      label: "Navy banner",
      render: (b, ctx) => [ctx.row(`
        <div style="text-align:center;font-family:${FONT};color:#ffffff">
          <div style="font-size:22px;line-height:1.22;font-weight:800">${ctx.ed("headline", b.headline)}</div>
          <div style="margin-top:8px;font-size:14px;line-height:1.5;opacity:.92">${ctx.ed("body", b.body)}</div>
          <div style="margin-top:14px">${storeLinks(b, ctx)}</div>
        </div>`, T.navy, "28px 26px")],
    },
  ],
  empty: () => ({
    type: "appPromo",
    feature: "In the app",
    headline: "Track your delivery, live",
    body: "Watch it go from our shop to their door, and reorder a favourite in two taps.",
  }),
  links: (b, ctx) => {
    const { ios, android } = appLinks(ctx.campaign.domain, { ios: b.iosHref, android: b.androidHref });
    return [
      ...(ios ? [{ href: ios, alt: "Download on the App Store", width: 120 }] : []),
      ...(android ? [{ href: android, alt: "Get it on Google Play", width: 134 }] : []),
    ];
  },
  images: (b) => (b.image ? [b.image] : []),
});
