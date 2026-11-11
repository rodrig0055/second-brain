import { decryptSecret } from "@/lib/crypto";
import type { DbConnection } from "../types";

// Google Ads API (REST). Auth is OAuth2: we store a long-lived refresh token
// plus the OAuth client id/secret and the developer token, and mint a short
// access token on demand. `loginCustomerId` is the manager (MCC) account, set as
// the login-customer-id header when the operating account sits under a manager.
const DEFAULT_API_VERSION = "v18";
const API_BASE = "https://googleads.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleAdsCreds = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

export type GoogleAdsTarget = {
  customerId: string; // digits only, no dashes
  loginCustomerId?: string; // manager account, digits only
  apiVersion: string;
  developerToken: string;
  accessToken: string;
};

/** Strip dashes/spaces from a customer id (1234567890, not 123-456-7890). */
export function normalizeCustomerId(input: string): string {
  return input.replace(/[^0-9]/g, "");
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function mintAccessToken(creds: GoogleAdsCreds): Promise<string> {
  const key = creds.refreshToken.slice(-12);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google OAuth ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as { access_token: string; expires_in?: number };
  const ttlMs = (json.expires_in ?? 3600) * 1000;
  tokenCache.set(key, {
    token: json.access_token,
    expiresAt: Date.now() + ttlMs - 5 * 60_000,
  });
  return json.access_token;
}

/** Resolve a usable target (customer id + access token) for a connection. */
export async function resolveGoogleAdsTarget(
  conn: DbConnection,
): Promise<GoogleAdsTarget> {
  if (!conn.encryptedCredentials) {
    throw new Error("Google Ads connection has no stored credentials.");
  }
  const creds = JSON.parse(decryptSecret(conn.encryptedCredentials)) as GoogleAdsCreds;
  const customerId = normalizeCustomerId(
    String(conn.config.customerId ?? conn.externalAccountId ?? ""),
  );
  if (!customerId) throw new Error("Google Ads connection is missing its customer id.");
  const loginCustomerId = conn.config.loginCustomerId
    ? normalizeCustomerId(String(conn.config.loginCustomerId))
    : undefined;

  const accessToken = await mintAccessToken(creds);
  return {
    customerId,
    loginCustomerId,
    apiVersion: String(conn.config.apiVersion ?? DEFAULT_API_VERSION),
    developerToken: creds.developerToken,
    accessToken,
  };
}

/** Run a GAQL query via searchStream; returns the flattened result rows. */
export async function gaql<T = Record<string, unknown>>(
  target: GoogleAdsTarget,
  query: string,
): Promise<T[]> {
  const url = `${API_BASE}/${target.apiVersion}/customers/${target.customerId}/googleAds:searchStream`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${target.accessToken}`,
    "developer-token": target.developerToken,
  };
  if (target.loginCustomerId) headers["login-customer-id"] = target.loginCustomerId;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Google Ads ${res.status}: ${text.slice(0, 500)}`);
  }
  // searchStream returns an array of batches, each with a `results` array.
  const batches = JSON.parse(text) as { results?: T[] }[];
  return batches.flatMap((b) => b.results ?? []);
}

/** Connectivity check: returns the customer's descriptive name + currency. */
export async function googleAdsAccountInfo(
  target: GoogleAdsTarget,
): Promise<{ name: string; currency: string; timezone: string }> {
  const rows = await gaql<{
    customer: {
      descriptiveName?: string;
      currencyCode?: string;
      timeZone?: string;
    };
  }>(
    target,
    "SELECT customer.descriptive_name, customer.currency_code, customer.time_zone FROM customer LIMIT 1",
  );
  const c = rows[0]?.customer ?? {};
  return {
    name: c.descriptiveName ?? target.customerId,
    currency: c.currencyCode ?? "USD",
    timezone: c.timeZone ?? "UTC",
  };
}

/** Verify raw credentials by minting a token + reading account info. */
export async function verifyGoogleAdsCredentials(
  creds: GoogleAdsCreds,
  customerId: string,
  loginCustomerId?: string,
): Promise<{ name: string; currency: string; timezone: string }> {
  const accessToken = await mintAccessToken(creds);
  return googleAdsAccountInfo({
    customerId: normalizeCustomerId(customerId),
    loginCustomerId: loginCustomerId ? normalizeCustomerId(loginCustomerId) : undefined,
    apiVersion: DEFAULT_API_VERSION,
    developerToken: creds.developerToken,
    accessToken,
  });
}

/** Google Ads reports cost in micros (1/1,000,000 of the currency unit). */
export function microsToUnits(micros: number | string | undefined): number {
  return Number(micros ?? 0) / 1_000_000;
}
