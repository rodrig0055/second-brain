/**
 * Renders one block, in one design, on its own.
 *
 * The gallery needs each block in isolation, not inside a campaign, so this
 * emits a minimal document containing only that block's rows. It posts its own
 * height to the parent because a block's height depends entirely on which
 * design is showing, and a fixed iframe height would either clip the tall ones
 * or leave a gap under the short ones.
 */
import { NextResponse } from "next/server";

import { apiTeam, accessErrorResponse } from "@/lib/access";
import { NEWSLETTER_TEAM_SLUG } from "@/lib/newsletter/access";
import { getBlockDef, variantOf, renderBlock } from "@/lib/newsletter/blocks";
import type { RenderCtx } from "@/lib/newsletter/blocks/types";
import { makeRow, makeButton, esc } from "@/lib/newsletter/blocks/kit";
import { sampleBlock, sampleCatalog, SAMPLE_PHOTO } from "@/lib/newsletter/samples";
import { T, homeUrl, brandAssets } from "@/lib/newsletter/tokens";
import { EFFECTS_CSS } from "@/lib/newsletter/blocks/effects";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ team: string }> },
) {
  const { team: teamSlug } = await params;
  try {
    const { team } = await apiTeam(teamSlug);
    if (team.slug !== NEWSLETTER_TEAM_SLUG) {
      return new NextResponse("Not found", { status: 404 });
    }

    const url = new URL(req.url);
    const kind = url.searchParams.get("kind") ?? "";
    const def = getBlockDef(kind);
    if (!def) return new NextResponse("Unknown block", { status: 404 });

    const variant = variantOf(def, url.searchParams.get("variant") ?? undefined).id;
    // The gallery shows design, not live data, so it renders against a brand
    // with committed slices and a fixed catalog.
    const domain = url.searchParams.get("domain") || "bloomly-sg.example";
    const brand = url.searchParams.get("brand") || "Bloomly SG";
    const home = homeUrl(domain);

    const block = sampleBlock(kind, variant, { brand, domain, home });
    const campaign = {
      brand, domain, date: new Date().toISOString().slice(0, 10),
      subject: "", preheader: "", blocks: [block],
    };

    const render: RenderCtx = {
      campaign,
      catalog: sampleCatalog(domain),
      assets: brandAssets(url.origin, domain),
      heroUrl: SAMPLE_PHOTO,
      imgs: new Map(),
      home,
      assetBase: url.origin,
      editable: false,
      index: 0,
      ed: (_f, text) => esc(text),
      row: (inner, bg, pad) => makeRow(inner, bg, pad),
      button: (label, href, labelHtml) => makeButton(label, href, labelHtml),
    };

    const rows = renderBlock(block, render).join("\n");

    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link href="${T.googleFonts}" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;background:${T.lavender}}
  /* The parent sizes this frame to the content exactly, so a scrollbar would
     only steal width from a 600px email and trigger the mobile breakpoint. */
  html{scrollbar-width:none}
  body::-webkit-scrollbar{display:none}
  img{border:0;line-height:100%;outline:0;-ms-interpolation-mode:bicubic}
  a{color:${T.navy}}
  @media only screen and (max-width:640px){
    .wrap{width:100%!important}
    .col{padding:4px!important}
    .col img{max-width:100%!important}
    .pname{font-size:11px!important;padding-top:6px!important}
  }
${EFFECTS_CSS}
</style></head>
<body>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.lavender}"><tr>
<td align="center" style="padding:0">
<table role="presentation" id="email" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
${rows || `<tr><td style="padding:26px;text-align:center;font:13px/1.5 system-ui,sans-serif;color:#8b93ad">This design renders nothing when the block has no content.</td></tr>`}
</table></td></tr></table>
<script>
(function(){
  // Links must not navigate inside the gallery.
  document.querySelectorAll("a").forEach(function(a){ a.addEventListener("click", function(e){ e.preventDefault(); }); });
  // Measure the email table, NOT the document. documentElement.scrollHeight is
  // floored at the viewport height, so a short block reported whatever the
  // frame already was and rendered a band of empty colour beneath itself.
  var email = document.getElementById("email");
  function post(){
    if (!email) return;
    parent.postMessage({
      type: "nl-block-height",
      kind: ${JSON.stringify(kind)},
      height: Math.ceil(email.getBoundingClientRect().height),
    }, location.origin);
  }
  post();
  window.addEventListener("load", post);
  // Images and webfonts settle after load and change the height, so report again.
  if (email) new ResizeObserver(post).observe(email);
})();
</script>
</body></html>`;

    return new NextResponse(html, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    // accessErrorResponse returns null for anything that is not an access
    // failure, and a route handler has to return a Response either way.
    return (
      accessErrorResponse(err) ??
      new NextResponse("Preview failed to render", { status: 500 })
    );
  }
}
