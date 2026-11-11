import { generateText } from "ai";
import { and, eq, like } from "drizzle-orm";
import { db } from "@/db";
import {
  adCreatives,
  integrationConnections,
  integrationRecords,
  teams,
} from "@/db/schema";
import { accessErrorResponse, apiBrand, apiUser } from "@/lib/access";
import { DEFAULT_CHAT_MODEL, resolveModel } from "@/lib/models";
import { buildSystemPrompt } from "@/lib/prompt";
import { logUsage } from "@/lib/usage";
import { extractConversions, type InsightRow } from "@/lib/integrations/meta/client";
import { META_ADS_TEAM_SLUG } from "@/lib/workspaces";

export const maxDuration = 300;

/**
 * Generate 3 concrete iteration ideas for one underperforming creative,
 * grounded in the brand's voice/offer rules (via buildSystemPrompt) and the
 * ad's own labels + metrics.
 */
export async function POST(req: Request) {
  try {
    const user = await apiUser();
    const body = (await req.json()) as {
      connectionId?: string;
      adId?: string;
      metric?: string;
      threshold?: number;
    };

    const connectionId = String(body.connectionId ?? "");
    const adId = String(body.adId ?? "");
    if (!connectionId || !adId) {
      return Response.json({ error: "Provide connectionId and adId." }, { status: 400 });
    }

    const conn = await db.query.integrationConnections.findFirst({
      where: eq(integrationConnections.id, connectionId),
    });
    if (!conn || conn.platform !== "meta") {
      return Response.json({ error: "Meta account not found." }, { status: 404 });
    }
    await apiBrand(conn.brandId);

    const creative = await db.query.adCreatives.findFirst({
      where: and(eq(adCreatives.connectionId, conn.id), eq(adCreatives.adId, adId)),
    });
    if (!creative) {
      return Response.json({ error: "Creative not found or not yet analyzed." }, { status: 404 });
    }

    // Aggregate this ad's lifetime metrics from its ad_insight rows
    // (externalId is "<adId>:<date>").
    const rows = await db
      .select({ data: integrationRecords.data })
      .from(integrationRecords)
      .where(
        and(
          eq(integrationRecords.connectionId, conn.id),
          eq(integrationRecords.recordType, "ad_insight"),
          like(integrationRecords.externalId, `${adId}:%`),
        ),
      );
    const agg = rows.reduce(
      (a, r) => {
        const row = r.data as unknown as InsightRow;
        const { conversions, conversionValue } = extractConversions(row);
        a.spend += Number(row.spend ?? 0);
        a.impressions += Number(row.impressions ?? 0);
        a.clicks += Number(row.inline_link_clicks ?? row.clicks ?? 0);
        a.conversions += conversions;
        a.revenue += conversionValue;
        return a;
      },
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
    );
    const currency = String(conn.config?.currency ?? "USD");
    const roas = agg.spend > 0 ? (agg.revenue / agg.spend).toFixed(2) : "0.00";
    const cpa = agg.conversions > 0 ? (agg.spend / agg.conversions).toFixed(2) : "N/A";
    const ctr = agg.impressions > 0 ? ((agg.clicks / agg.impressions) * 100).toFixed(2) : "0.00";

    // Brand-aware system prompt. Prefer the meta-ads team's context.
    const metaTeam = await db.query.teams.findFirst({
      where: eq(teams.slug, META_ADS_TEAM_SLUG),
    });
    const system = metaTeam
      ? await buildSystemPrompt(conn.brandId, metaTeam.id)
      : "You are a senior Meta Ads creative strategist.";

    const metric = body.metric ? String(body.metric) : "roas";
    const threshold = Number.isFinite(Number(body.threshold)) ? Number(body.threshold) : null;

    const prompt = [
      "This Meta ad is underperforming and needs iteration.",
      "",
      "## Current creative",
      `- Ad name: ${creative.adName || "(none)"}`,
      `- Media type: ${creative.mediaType}`,
      `- Asset type: ${creative.aiAssetType ?? "?"}`,
      `- Messaging angle: ${creative.messagingAngle ?? "?"}`,
      `- Hook tactic: ${creative.hookTactic ?? "?"}`,
      `- Funnel stage: ${creative.funnelStage ?? "?"}`,
      `- Headline: ${creative.title || "(none)"}`,
      `- Primary text: ${creative.body || "(none)"}`,
      `- Call to action: ${creative.callToAction || "(none)"}`,
      "",
      "## Performance",
      `- Spend: ${currency} ${agg.spend.toFixed(2)}`,
      `- Purchases: ${agg.conversions}`,
      `- ROAS: ${roas}× · CPA: ${cpa} · CTR: ${ctr}%`,
      threshold !== null
        ? `- It is failing the target of ${metric.toUpperCase()} ${metric === "cpa" ? "≤" : "≥"} ${threshold}.`
        : "",
      "",
      "## Task",
      "Give exactly 3 concrete iteration ideas to test next, as a numbered markdown list. Cover different levers:",
      "1. A NEW HOOK (different first 3 seconds / headline) — write the actual hook.",
      "2. An ANGLE SHIFT (different messaging angle) — name the new angle and the core message.",
      "3. A FORMAT / ASSET change (e.g. static→UGC video, add social proof overlay) — be specific.",
      "For each, add one line on WHY it should beat the current creative. Stay on-brand and keep it tight.",
    ]
      .filter(Boolean)
      .join("\n");

    const model = await resolveModel(DEFAULT_CHAT_MODEL);
    const { text, usage } = await generateText({
      model,
      system,
      prompt,
      // Stop the model call if the client disconnects.
      abortSignal: req.signal,
    });

    await logUsage({
      kind: "task",
      model: DEFAULT_CHAT_MODEL,
      usage,
      userId: user.id,
      brandId: conn.brandId,
      teamId: metaTeam?.id ?? null,
      refId: adId,
    });

    return Response.json({ ideas: text });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("meta creative iterate error", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to generate ideas" },
      { status: 500 },
    );
  }
}
