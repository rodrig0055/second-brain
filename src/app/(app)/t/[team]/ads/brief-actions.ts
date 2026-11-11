"use server";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { requireAdsBrand } from "@/lib/ads/access";
import type { AdSetOption, FunnelSummary } from "@/lib/ads/drafts/context";
import { loadDraftContext } from "@/lib/ads/drafts/load-context";
import { proposeDrafts, type DraftVariant } from "@/lib/ads/drafts/propose";

/**
 * The brief, as a server action.
 *
 * Every argument arrives from a form, so the gate runs here and not only on the
 * page that rendered it: the team check and the brand check are separate grants
 * and a POST can be made without ever loading the page.
 */

/** How far back the suggestions read. A month covers a full payday cycle. */
const WINDOW_DAYS = 30;

function ymd(daysAgo: number): string {
  const ms = Date.now() - daysAgo * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export type BriefState = {
  status: "idle" | "ready" | "error";
  error?: string;
  variants?: DraftVariant[];
  note?: string;
  adSets?: AdSetOption[];
  funnels?: FunnelSummary[];
  windowLabel?: string;
  spendLabel?: string;
  brandId?: string;
  inputs?: Record<string, string>;
  model?: string;
};

export async function suggestDrafts(
  _prev: BriefState,
  formData: FormData,
): Promise<BriefState> {
  const teamSlug = String(formData.get("team") ?? "");
  const brandId = String(formData.get("brandId") ?? "");
  const templateId = String(formData.get("templateId") ?? "");
  const model = String(formData.get("model") ?? "").trim();

  const { user, brand } = await requireAdsBrand(teamSlug, brandId);

  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brandId),
      eq(integrationConnections.platform, "meta"),
    ),
  });
  if (!connection || connection.status === "disconnected") {
    return {
      status: "error",
      error: `${brand.name} has no working Meta connection, so there is no performance data to write from.`,
    };
  }

  // Everything the template asks for, kept so the fields survive a re-render
  // and so the saved draft carries what the person typed.
  const inputs: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (["team", "brandId", "templateId", "model"].includes(key)) continue;
    if (typeof value === "string") inputs[key] = value;
  }

  const range = { start: ymd(WINDOW_DAYS), end: ymd(1) };
  const currency = String(connection.config?.currency ?? "USD");

  try {
    const context = await loadDraftContext({
      connectionId: connection.id,
      brandId,
      brandName: brand.name,
      currency,
      range,
      windowDays: WINDOW_DAYS,
    });

    const result = await proposeDrafts({
      templateId,
      brandId,
      userId: user.id,
      inputs,
      context,
      model: model || undefined,
    });

    const symbol = currency === "USD" ? "$" : "";
    return {
      status: "ready",
      variants: result.variants,
      note: result.note,
      adSets: context.adSets,
      funnels: context.funnels,
      windowLabel: `${range.start} to ${range.end}`,
      spendLabel:
        context.totals.spend > 0
          ? `${symbol}${context.totals.spend.toFixed(0)} spent, ${context.totals.purchases} purchases, CIR ${context.totals.cir.toFixed(0)}%`
          : "No spend in this window, so the suggestions have nothing to learn from.",
      brandId,
      inputs,
      model: result.model,
    };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      brandId,
      inputs,
    };
  }
}
