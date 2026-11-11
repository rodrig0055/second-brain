import { decryptSecret } from "@/lib/crypto";
import type { DbConnection } from "../types";

const DEFAULT_API_VERSION = "2025-10";

// Credentials we store (encrypted) for a Shopify connection. We use the
// client_credentials grant, which returns a ~24h offline token — so we persist
// the long-lived client id/secret and mint a fresh access token on demand.
// `accessToken` is still honored for connections created with a pasted token.
export type ShopifyCreds = {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
};

export type ShopifyTarget = {
  shop: string; // e.g. dqig35-q1.myshopify.com
  apiVersion: string;
  accessToken: string;
};

// In-memory token cache (per shop+client). Minted tokens last ~24h; we refresh
// a little early. Survives within a warm serverless instance; a cold start just
// re-mints, which is cheap.
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function mintAccessToken(
  shop: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const key = `${shop}:${clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify token mint ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as { access_token: string; expires_in?: number };
  const ttlMs = (json.expires_in ?? 86_400) * 1000;
  tokenCache.set(key, { token: json.access_token, expiresAt: Date.now() + ttlMs - 5 * 60_000 });
  return json.access_token;
}

/** Resolve the shop domain + a valid access token for a connection. */
export async function resolveShopifyTarget(conn: DbConnection): Promise<ShopifyTarget> {
  const shop = String(conn.config.shop ?? conn.externalAccountId ?? "").trim();
  if (!shop) throw new Error("Shopify connection is missing its shop domain.");
  if (!conn.encryptedCredentials) {
    throw new Error("Shopify connection has no stored credentials.");
  }
  const creds = JSON.parse(decryptSecret(conn.encryptedCredentials)) as ShopifyCreds;
  const apiVersion = String(conn.config.apiVersion ?? DEFAULT_API_VERSION);

  let accessToken = creds.accessToken;
  if (!accessToken) {
    if (!creds.clientId || !creds.clientSecret) {
      throw new Error("Shopify connection is missing client id/secret.");
    }
    accessToken = await mintAccessToken(shop, creds.clientId, creds.clientSecret);
  }
  return { shop, apiVersion, accessToken };
}

/** Mint a token directly from raw credentials (used when first connecting). */
export async function verifyShopifyCredentials(
  shop: string,
  clientId: string,
  clientSecret: string,
): Promise<{ name: string; currencyCode: string; ianaTimezone: string }> {
  const token = await mintAccessToken(shop, clientId, clientSecret);
  return shopifyShopInfo({ shop, apiVersion: DEFAULT_API_VERSION, accessToken: token });
}

/** Run an Admin GraphQL query against a resolved Shopify store. */
export async function shopifyGraphql<T = unknown>(
  target: ShopifyTarget,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const url = `https://${target.shop}/admin/api/${target.apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": target.accessToken,
    },
    body: JSON.stringify({ query, variables: variables ?? {} }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text) as { data?: T; errors?: unknown };
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }
  return json.data as T;
}

/** Lightweight connectivity check — returns shop name/currency/timezone. */
export async function shopifyShopInfo(target: ShopifyTarget) {
  const data = await shopifyGraphql<{
    shop: { name: string; currencyCode: string; ianaTimezone: string };
  }>(target, `query { shop { name currencyCode ianaTimezone } }`);
  return data.shop;
}
