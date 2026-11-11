/**
 * Variant B: hybrid. Images only for the campaign hero and product photos;
 * every headline, price, button, code and link is real text.
 *
 * Email-safe by construction: tables for layout, inline styles, a VML fallback
 * so buttons stay clickable rectangles in Outlook, and a font stack that
 * degrades cleanly because Gmail strips the webfont regardless.
 *
 * This file no longer knows what a block is. It builds the render context and
 * asks the registry; each block kind renders itself, in its own module.
 */
import type { Campaign } from "./campaign";
import type { Catalog } from "./catalog";
import { T, homeUrl, type BrandAssets } from "./tokens";
import { renderBlock } from "./blocks";
import type { RenderCtx } from "./blocks/types";
import { FONT, esc, makeRow, makeButton } from "./blocks/kit";
import { EFFECTS_CSS } from "./blocks/effects";

export type EmitOptions = {
  /** Where /public is served from. Needed for the footer's social icons. */
  assetBase?: string;
  /**
   * Preview only. Wraps editable copy in `data-edit="index:field"` spans and
   * injects a small script that makes them contenteditable and posts each
   * change to the parent page. Never set for the HTML that goes to SendPulse.
   */
  editable?: boolean;
};

export function emitHtmlEmail(
  c: Campaign,
  cat: Catalog,
  heroUrl: string,
  imgs: Map<string, string> = new Map(),
  assets?: BrandAssets,
  opts: EmitOptions = {},
): string {
  const home = homeUrl(c.domain);
  const editable = !!opts.editable;
  const rows: string[] = [];

  for (const [index, block] of c.blocks.entries()) {
    const ctx: RenderCtx = {
      campaign: c,
      catalog: cat,
      assets: assets ?? null,
      heroUrl,
      imgs,
      home,
      assetBase: opts.assetBase ?? "",
      editable,
      index,
      // In preview mode a text run becomes an editable span bound to its field.
      ed: (field, text) =>
        editable
          ? `<span data-edit="${index}:${field}" style="outline:none">${esc(text)}</span>`
          : esc(text),
      row: (inner, bg, pad) => makeRow(inner, bg, pad),
      button: (label, href, labelHtml) => makeButton(label, href, labelHtml),
    };
    rows.push(...renderBlock(block, ctx));
  }

  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${esc(c.brand)} ${esc(c.date)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<link href="${T.googleFonts}" rel="stylesheet">
<style>
  body{margin:0;padding:0;background:${T.lavender};-webkit-font-smoothing:antialiased}
  img{border:0;line-height:100%;outline:0;text-decoration:none;-ms-interpolation-mode:bicubic}
  a{color:${T.navy}}
  @media only screen and (max-width:640px){
    .wrap{width:100%!important}
    .col{padding:4px!important}
    .col img{max-width:100%!important}
    .pname{font-size:11px!important;padding-top:6px!important}
  }
  @media (prefers-color-scheme:dark){
    body,.bgfix{background:${T.lavender}!important}
  }
${EFFECTS_CSS}
</style></head>
<body>
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</div>
${editable ? EDIT_SCRIPT : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.lavender}" class="bgfix"><tr>
<td align="center" style="padding:0">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
${rows.join("\n")}
<tr><td bgcolor="${T.lavender}" style="padding:22px 30px;text-align:center;font:12px/1.6 Arial,sans-serif;color:#6b7392">
&copy; ${new Date(c.date).getFullYear()} ${esc(c.brand)} &bull; You are receiving this as a subscriber of ${esc(c.brand)}.
<a href="{{unsubscribe}}" style="color:#6b7392">Unsubscribe</a>.
</td></tr>
</table></td></tr></table></body></html>`;
}

/** Injected only in preview mode. Never reaches SendPulse. */
const EDIT_SCRIPT = `<style>[data-edit]{cursor:text;border-radius:3px;box-shadow:0 0 0 1px rgba(214,58,96,.0);transition:box-shadow .15s}[data-edit]:hover{box-shadow:0 0 0 1px rgba(214,58,96,.45)}[data-edit]:focus{box-shadow:0 0 0 2px #D63A60;background:rgba(255,255,255,.6)}[data-edit]:empty::before{content:"click to add";font-size:11px;font-weight:400;font-style:italic;letter-spacing:0;line-height:1.6;color:#b9c0d6;text-transform:none;vertical-align:middle}</style>
<script>
(function(){
  function init(){
  var els=document.querySelectorAll("[data-edit]");
  els.forEach(function(el){
    el.setAttribute("contenteditable","true"); el.setAttribute("spellcheck","false");
    el.addEventListener("keydown",function(e){ if(e.key==="Enter"){e.preventDefault();el.blur();} if(e.key==="Escape"){el.textContent=el.dataset.orig||"";el.blur();} });
    el.addEventListener("focus",function(){ el.dataset.orig=el.textContent; });
    el.addEventListener("blur",function(){
      var v=el.textContent.replace(/\\s+/g," ").trim(); if(v===(el.dataset.orig||"").trim()) return;
      var p=el.dataset.edit.split(":"); parent.postMessage({type:"nl-edit",index:+p[0],field:p[1],value:v},location.origin);
    });
  });
  // links must not navigate while editing
  document.querySelectorAll("a").forEach(function(a){ a.addEventListener("click",function(e){ e.preventDefault(); }); });
  }
  // This script is emitted near the top of <body>, so the editable spans below
  // it have not been parsed yet. Wait for the document before binding.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
</script>`;

export { FONT };
