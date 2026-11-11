import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { encryptSecret } from "@/lib/crypto";
import { exchangeAccountCode } from "../tiktok/account-auth";
import { missingScopes } from "../tiktok/tokens";
import { fetchProfile } from "./client";
import type { DbConnection } from "../types";

/**
 * Finish an account-holder grant: trade the code, check the scopes, name the
 * account, and upsert the connection on (brand, tiktok_organic, open_id).
 *
 * Scopes are checked here rather than at first sync because an account holder
 * can untick permissions on TikTok's consent page, and a connection missing
 * `video.list` would connect cleanly and then sync nothing, forever.
 */
export async function completeAccountGrant(opts: {
  brandId: string;
  userId: string;
  authCode: string;
  redirectUri: string;
}): Promise<DbConnection> {
  const creds = await exchangeAccountCode(opts.authCode, opts.redirectUri);
  const missing = missingScopes(creds.scope);
  if (missing.length) {
    throw new Error(
      `The TikTok account did not grant: ${missing.join(", ")}. Reconnect and leave every permission ticked, or add the scope to the developer app.`,
    );
  }
  if (!creds.openId) throw new Error("TikTok did not return the account's open_id.");

  // No range: identity fields only, which are real time.
  const profile = await fetchProfile(creds).catch(() => ({}) as Awaited<ReturnType<typeof fetchProfile>>);
  const username = profile.username ?? "";
  const displayName = username ? `@${username}` : profile.display_name || "TikTok account";

  const existing = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, opts.brandId),
      eq(integrationConnections.platform, "tiktok_organic"),
      eq(integrationConnections.externalAccountId, creds.openId),
    ),
  });
  const config = {
    ...(existing?.config ?? {}),
    openId: creds.openId,
    username,
    scope: creds.scope,
    ...(typeof profile.is_business_account === "boolean"
      ? { isBusinessAccount: profile.is_business_account }
      : {}),
  };
  const encrypted = encryptSecret(JSON.stringify(creds));

  const [conn] = await db
    .insert(integrationConnections)
    .values({
      brandId: opts.brandId,
      platform: "tiktok_organic",
      displayName,
      externalAccountId: creds.openId,
      authType: "oauth",
      encryptedCredentials: encrypted,
      config,
      status: "connected",
      createdById: opts.userId,
    })
    .onConflictDoUpdate({
      target: [
        integrationConnections.brandId,
        integrationConnections.platform,
        integrationConnections.externalAccountId,
      ],
      set: {
        displayName,
        encryptedCredentials: encrypted,
        config,
        status: "connected",
        syncError: null,
        failureKind: null,
        recoveryAction: null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return conn;
}
