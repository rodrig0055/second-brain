import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The connect half of TikTok OAuth, shared by both kinds of grant:
 *
 *   account   a TikTok account holder (organic insights, publishing).
 *             Authorization URL: "TikTok account holder authorization URL".
 *   ads       an advertiser (ad accounts, reporting).
 *             Authorization URL: "Advertiser authorization URL".
 *
 * Both URLs are copied from TikTok for Business → My Apps → App Detail rather
 * than assembled here. TikTok generates them from the app's settings (client
 * key, scopes, the registered redirect), and a hand-built one that drifts from
 * those settings fails on TikTok's page with no error we can see. We only add
 * `state`.
 *
 * `state` carries who started the connect and for which brand, signed with
 * AUTH_SECRET, so the callback can trust it without a server-side session
 * table, and a link started by one admin cannot be completed by another.
 */

export type TikTokGrantKind = "account" | "ads";

export type ConnectState = {
  kind: TikTokGrantKind;
  brandId: string;
  userId: string;
  /** Epoch ms after which the callback refuses it. */
  exp: number;
  nonce: string;
};

/** TikTok's auth codes live 10 minutes (account) and 1 hour (ads). */
export const STATE_TTL_MS = 30 * 60_000;

const AUTH_URL_ENV: Record<TikTokGrantKind, string> = {
  account: "TIKTOK_ACCOUNT_AUTH_URL",
  ads: "TIKTOK_ADVERTISER_AUTH_URL",
};

function stateKey(secret = process.env.AUTH_SECRET ?? ""): Buffer {
  if (!secret) throw new Error("AUTH_SECRET is not set; cannot sign the TikTok connect state.");
  // A separate derived key, so a state token is never also a valid signature
  // for anything else that might HMAC with AUTH_SECRET.
  return createHmac("sha256", secret).update("tiktok-oauth-state").digest();
}

export function signState(
  s: Omit<ConnectState, "exp" | "nonce">,
  now = Date.now(),
  secret?: string,
): string {
  const full: ConnectState = {
    ...s,
    exp: now + STATE_TTL_MS,
    nonce: randomBytes(9).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(full)).toString("base64url");
  const mac = createHmac("sha256", stateKey(secret)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** The decoded state, or null when it is forged, malformed or expired. */
export function verifyState(
  token: string,
  now = Date.now(),
  secret?: string,
): ConnectState | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", stateKey(secret)).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let s: ConnectState;
  try {
    s = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ConnectState;
  } catch {
    return null;
  }
  if (s.kind !== "account" && s.kind !== "ads") return null;
  if (typeof s.brandId !== "string" || typeof s.userId !== "string") return null;
  if (typeof s.exp !== "number" || s.exp < now) return null;
  return s;
}

export function authUrlConfigured(kind: TikTokGrantKind): boolean {
  return Boolean(process.env[AUTH_URL_ENV[kind]]);
}

/** The portal's authorization URL for this kind, with our `state` set. */
export function buildAuthUrl(
  kind: TikTokGrantKind,
  state: string,
  base = process.env[AUTH_URL_ENV[kind]] ?? "",
): string {
  if (!base) {
    throw new Error(
      `${AUTH_URL_ENV[kind]} is not set. Copy it from TikTok for Business → My Apps → App Detail.`,
    );
  }
  const url = new URL(base);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * The redirect URI the token exchange must repeat, read back out of the
 * authorization URL so the two can never disagree. TikTok compares them
 * exactly, trailing slash included.
 */
export function redirectUriFor(
  kind: TikTokGrantKind,
  base = process.env[AUTH_URL_ENV[kind]] ?? "",
): string {
  if (!base) return "";
  return new URL(base).searchParams.get("redirect_uri") ?? "";
}
