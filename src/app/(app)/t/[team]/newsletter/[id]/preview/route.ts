/**
 * Serves the rendered email for the editor's preview pane.
 *
 * Returns the same HTML the handoff would use, so what a reviewer approves is
 * what gets sent. A render that fails validation returns the findings as a
 * readable page rather than a blank frame — a preview that silently shows
 * nothing is how a broken campaign gets approved.
 */
import { NextResponse } from "next/server";

import { apiTeam, accessErrorResponse } from "@/lib/access";
import { NEWSLETTER_TEAM_SLUG } from "@/lib/newsletter/access";
import { loadCampaign } from "@/lib/newsletter/store";
import { renderAndCache } from "@/lib/newsletter/render";

export const maxDuration = 300;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ team: string; id: string }> },
) {
  const { team: teamSlug, id } = await params;
  try {
    const { team } = await apiTeam(teamSlug);
    if (team.slug !== NEWSLETTER_TEAM_SLUG) {
      return new NextResponse("Not found", { status: 404 });
    }

    const row = await loadCampaign(id, team.id);
    if (!row) return new NextResponse("Not found", { status: 404 });

    const result = await renderAndCache({
      campaignId: row.id,
      brandId: row.brandId,
      domain: row.brandDomain,
      campaign: {
        brand: row.brandName,
        domain: row.brandDomain,
        date: row.sendDate,
        subject: row.subject,
        preheader: row.preheader,
        blocks: row.blocks,
      },
      heroAssetUrl: row.heroAssetUrl,
      derivedImages: row.derivedImages,
      assetBase: new URL(req.url).origin,
      // ?edit=1 is the editor's iframe: copy becomes contenteditable and posts
      // changes to the parent. The plain URL is the exact HTML a handoff sends.
      emit: { editable: new URL(req.url).searchParams.get("edit") === "1" },
    });

    const body =
      result.errors > 0
        ? `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:28px;font:14px/1.6 ui-sans-serif,system-ui,sans-serif;color:#1e2438">
<h1 style="margin:0 0 4px;font-size:15px">Not rendered</h1>
<p style="margin:0 0 16px;color:#6b7392">${result.errors} error${result.errors === 1 ? "" : "s"} must be fixed first.</p>
<ul style="margin:0;padding-left:18px">${result.findings
            .filter((f) => f.level === "error")
            .map((f) => `<li style="margin:6px 0"><b>${escapeHtml(f.where)}</b> — ${escapeHtml(f.message)}</li>`)
            .join("")}</ul></body>`
        : result.html;

    return new NextResponse(body, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // The preview must always reflect the current blocks and live stock.
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    // A render failure is not an auth failure: say so in the frame rather than
    // handing the reviewer an empty preview they might approve anyway.
    console.error("newsletter preview error", err);
    return new NextResponse(
      `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:28px;font:14px/1.6 ui-sans-serif,system-ui,sans-serif;color:#b4231f">
<h1 style="margin:0 0 6px;font-size:15px">Preview failed to render</h1>
<p style="margin:0;color:#6b7392">${escapeHtml(err instanceof Error ? err.message : String(err))}</p>
</body>`,
      { status: 500, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
