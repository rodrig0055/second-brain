import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { accessErrorResponse, apiUser } from "@/lib/access";
import { redactError } from "@/lib/integrations/http";
import { redirectUriFor, verifyState } from "@/lib/integrations/tiktok/oauth";
import { completeAccountGrant } from "@/lib/integrations/tiktok_organic/connect";
import { syncConnection } from "@/lib/integrations/sync";
import { exchangeAdvertiserCode, fetchAdvertisers } from "@/lib/integrations/tiktok_ads/client";
import {
  PENDING_COOKIE,
  PENDING_TTL_S,
  createAdsConnections,
  sealPending,
} from "@/lib/integrations/tiktok_ads/connect";

export const maxDuration = 300;

/**
 * TikTok sends the admin back here after consent. Register this route as BOTH
 * the "TikTok account holder redirect URL" and the "Advertiser redirect URL" of
 * the developer app, with the trailing slash TikTok requires:
 *
 *   https://<app>/api/integrations/tiktok/callback/
 *
 * Next.js answers the slashed form with a redirect to this one, query intact.
 * The `state` says which kind of grant this is and who started it.
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
    const state = verifyState(url.searchParams.get("state") ?? "");
    if (!state) {
      return back({ tiktok: "error", reason: "The connect link expired or was not started here. Try again." });
    }
    // Only the admin who started the connect may finish it, so a consent link
    // forwarded to someone else cannot attach their account to our brand.
    if (state.userId !== user.id || user.role !== "admin") {
      return NextResponse.json({ error: "This connect was started by someone else." }, { status: 403 });
    }

    // Account-holder grants come back as `code`, advertiser grants as
    // `auth_code` (sometimes alongside `code`). Take whichever is present.
    const code = url.searchParams.get("auth_code") ?? url.searchParams.get("code") ?? "";
    if (!code) {
      const denied = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      return back({ tiktok: "error", reason: denied ? `TikTok: ${denied}` : "TikTok returned no authorization code." });
    }

    if (state.kind === "ads") {
      const { accessToken, advertiserIds } = await exchangeAdvertiserCode(code);
      const advertisers = await fetchAdvertisers(accessToken, advertiserIds);
      if (advertisers.length === 0) {
        return back({ tiktok: "error", reason: "That TikTok user manages no ad accounts." });
      }
      const pending = { brandId: state.brandId, userId: user.id, accessToken, advertisers };
      // One account leaves nothing to choose.
      if (advertisers.length === 1) {
        const [conn] = await createAdsConnections(
          { ...pending, exp: Date.now() + PENDING_TTL_S * 1000 },
          [advertisers[0].advertiserId],
        );
        const sync = await syncConnection(conn);
        revalidatePath("/admin/integrations");
        return back(
          sync.ok
            ? { tiktok: "connected", account: conn.displayName }
            : { tiktok: "connected", account: conn.displayName, reason: `First sync failed: ${sync.error ?? "unknown"}` },
        );
      }
      if (advertisers.length > 40) {
        return back({
          tiktok: "error",
          reason: `That TikTok user manages ${advertisers.length} ad accounts; authorize with a user scoped to this brand's accounts.`,
        });
      }
      const res = back({ tiktok: "pick" });
      res.cookies.set(PENDING_COOKIE, sealPending(pending), {
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "lax",
        path: "/admin/integrations",
        maxAge: PENDING_TTL_S,
      });
      return res;
    }

    const conn = await completeAccountGrant({
      brandId: state.brandId,
      userId: user.id,
      authCode: code,
      redirectUri: redirectUriFor("account"),
    });
    const sync = await syncConnection(conn);
    revalidatePath("/admin/integrations");
    return back(
      sync.ok
        ? { tiktok: "connected", account: conn.displayName }
        : { tiktok: "connected", account: conn.displayName, reason: `First sync failed: ${sync.error ?? "unknown"}` },
    );
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    return back({ tiktok: "error", reason: redactError(err).slice(0, 300) });
  }
}
