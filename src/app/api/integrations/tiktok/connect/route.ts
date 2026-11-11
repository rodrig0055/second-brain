import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { brands } from "@/db/schema";
import { accessErrorResponse, apiUser } from "@/lib/access";
import { encryptionConfigured } from "@/lib/crypto";
import { tiktokAppConfigured } from "@/lib/integrations/tiktok/api";
import {
  authUrlConfigured,
  buildAuthUrl,
  signState,
  type TikTokGrantKind,
} from "@/lib/integrations/tiktok/oauth";

/**
 * Start connecting a TikTok account (kind=account) or advertiser (kind=ads)
 * to a brand: an admin lands here from Settings → Integrations and leaves for
 * TikTok's consent page. The callback route finishes the job.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (params: Record<string, string>) => {
    const to = new URL("/admin/integrations", url.origin);
    for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
    return NextResponse.redirect(to);
  };

  try {
    const user = await apiUser();
    if (user.role !== "admin") {
      return NextResponse.json({ error: "Admins only" }, { status: 403 });
    }

    const kind = url.searchParams.get("kind") as TikTokGrantKind | null;
    const brandId = url.searchParams.get("brandId") ?? "";
    if (kind !== "account" && kind !== "ads") {
      return back({ tiktok: "error", reason: "Unknown connection kind." });
    }
    const brand = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
    if (!brand) return back({ tiktok: "error", reason: "Unknown brand." });

    if (!encryptionConfigured()) {
      return back({ tiktok: "error", reason: "INTEGRATIONS_ENC_KEY is not set." });
    }
    if (!tiktokAppConfigured() || !authUrlConfigured(kind)) {
      return back({
        tiktok: "error",
        reason:
          kind === "account"
            ? "TikTok app is not configured: set TIKTOK_APP_ID, TIKTOK_APP_SECRET and TIKTOK_ACCOUNT_AUTH_URL."
            : "TikTok app is not configured: set TIKTOK_APP_ID, TIKTOK_APP_SECRET and TIKTOK_ADVERTISER_AUTH_URL.",
      });
    }

    const state = signState({ kind, brandId: brand.id, userId: user.id });
    return NextResponse.redirect(buildAuthUrl(kind, state));
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
