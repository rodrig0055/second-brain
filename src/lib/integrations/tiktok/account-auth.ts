import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { DbConnection } from "../types";
import { TikTokApiError, tiktokApp, tiktokPost } from "./api";
import {
  type AccountCredentials,
  type TokenResponse,
  credentialsFromResponse,
  needsRefresh,
  parseCredentials,
} from "./tokens";

/** Trade the code from the account holder's redirect for the first token pair. */
export async function exchangeAccountCode(
  authCode: string,
  redirectUri: string,
): Promise<AccountCredentials> {
  const { appId, secret } = tiktokApp();
  const r = await tiktokPost<TokenResponse>("/tt_user/oauth2/token/", null, {
    client_id: appId,
    client_secret: secret,
    grant_type: "authorization_code",
    auth_code: authCode,
    redirect_uri: redirectUri,
  });
  return credentialsFromResponse(r);
}

async function refreshAccountToken(c: AccountCredentials): Promise<AccountCredentials> {
  const { appId, secret } = tiktokApp();
  const r = await tiktokPost<TokenResponse>("/tt_user/oauth2/refresh_token/", null, {
    client_id: appId,
    client_secret: secret,
    grant_type: "refresh_token",
    refresh_token: c.refreshToken,
  });
  return credentialsFromResponse(r, Date.now(), c);
}

function storedCredentials(conn: Pick<DbConnection, "encryptedCredentials">): AccountCredentials {
  if (!conn.encryptedCredentials) {
    throw new Error("TikTok connection has no stored credentials; reconnect the account.");
  }
  return parseCredentials(decryptSecret(conn.encryptedCredentials));
}

/**
 * A usable access token for this connection, refreshing it first when it is
 * within half an hour of expiry. Access tokens last one day, so the daily sync
 * refreshes nearly every run.
 *
 * Two callers can race here (the cron and someone pressing "Sync now"). The
 * write is conditional on the stored blob being the one we read, so the loser
 * never overwrites the winner's newer token with its own. If our refresh is
 * refused because the other caller already rotated the refresh token, the
 * stored row is re-read and its token used instead of failing the sync.
 */
export async function accountAuth(
  conn: Pick<DbConnection, "id" | "encryptedCredentials">,
): Promise<AccountCredentials> {
  const current = storedCredentials(conn);
  if (!needsRefresh(current)) return current;

  let next: AccountCredentials;
  try {
    next = await refreshAccountToken(current);
  } catch (err) {
    const fresh = await db.query.integrationConnections.findFirst({
      where: eq(integrationConnections.id, conn.id),
    });
    if (fresh && fresh.encryptedCredentials !== conn.encryptedCredentials) {
      const theirs = storedCredentials(fresh);
      if (!needsRefresh(theirs)) return theirs;
    }
    if (err instanceof TikTokApiError && err.needsReauth) {
      throw new Error(
        `TikTok refresh token expired or revoked; reconnect the account. (${err.message})`,
      );
    }
    throw err;
  }

  const blob = encryptSecret(JSON.stringify(next));
  const written = await db
    .update(integrationConnections)
    .set({ encryptedCredentials: blob, updatedAt: new Date() })
    .where(
      and(
        eq(integrationConnections.id, conn.id),
        conn.encryptedCredentials
          ? eq(integrationConnections.encryptedCredentials, conn.encryptedCredentials)
          : undefined,
      ),
    )
    .returning({ id: integrationConnections.id });
  if (written.length === 0) {
    // Someone else refreshed between our read and our write. Their token is
    // the stored one now; ours still works for this call.
    console.warn(`tiktok: concurrent token refresh on connection ${conn.id}; kept the stored one`);
  }
  // Callers holding this `conn` object would otherwise re-refresh on the next
  // call with an already-rotated refresh token.
  conn.encryptedCredentials = written.length ? blob : conn.encryptedCredentials;
  return next;
}
