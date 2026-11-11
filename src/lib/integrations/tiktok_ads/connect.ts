import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type { DbConnection } from "../types";
import type { Advertiser } from "./client";

/**
 * An advertiser grant returns ONE token for every ad account the authorizing
 * user manages, which across our brands is usually several. The callback can't
 * know which belong to the brand being connected, so it parks the grant here
 * for a few minutes and Settings → Integrations asks.
 *
 * Parked in an encrypted, httpOnly cookie rather than a table: it lives
 * minutes, belongs to one browser, and must never be readable by the page.
 */

export const PENDING_COOKIE = "tiktok_ads_pending";
export const PENDING_TTL_S = 15 * 60;

export type PendingAdsGrant = {
  brandId: string;
  userId: string;
  accessToken: string;
  advertisers: Advertiser[];
  exp: number;
};

export function sealPending(p: Omit<PendingAdsGrant, "exp">, now = Date.now()): string {
  return encryptSecret(JSON.stringify({ ...p, exp: now + PENDING_TTL_S * 1000 }));
}

export function openPending(sealed: string | undefined, now = Date.now()): PendingAdsGrant | null {
  if (!sealed) return null;
  try {
    const p = JSON.parse(decryptSecret(sealed)) as PendingAdsGrant;
    return p.exp > now ? p : null;
  } catch {
    return null;
  }
}

/** One connection per chosen ad account, all sharing the grant's token. */
export async function createAdsConnections(
  p: PendingAdsGrant,
  advertiserIds: string[],
): Promise<DbConnection[]> {
  const chosen = p.advertisers.filter((a) => advertiserIds.includes(a.advertiserId));
  const encrypted = encryptSecret(JSON.stringify({ accessToken: p.accessToken }));
  const out: DbConnection[] = [];
  for (const a of chosen) {
    const config = { advertiserId: a.advertiserId, currency: a.currency, timezone: a.timezone };
    const [conn] = await db
      .insert(integrationConnections)
      .values({
        brandId: p.brandId,
        platform: "tiktok",
        displayName: a.name,
        externalAccountId: a.advertiserId,
        authType: "oauth",
        encryptedCredentials: encrypted,
        config,
        status: "connected",
        createdById: p.userId,
      })
      .onConflictDoUpdate({
        target: [
          integrationConnections.brandId,
          integrationConnections.platform,
          integrationConnections.externalAccountId,
        ],
        set: {
          displayName: a.name,
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
    out.push(conn);
  }
  return out;
}
