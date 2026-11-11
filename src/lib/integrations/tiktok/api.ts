import {
  READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  fetchBounded,
  redactSecrets,
} from "../http";

/**
 * One HTTP client for TikTok's API for Business (business-api.tiktok.com), which
 * serves both halves of our TikTok integration: the Accounts API (organic
 * profile + post insights, publishing) and the Marketing API (ads reporting).
 *
 * Two TikTok habits shape it:
 *
 *  - Every response is HTTP 200 with `{ code, message, request_id, data }`.
 *    `code !== 0` is the failure, so a status check alone reads an expired
 *    token as success.
 *  - GET endpoints take arrays and objects as JSON inside the query string
 *    (`fields=["item_id","likes"]`), not repeated keys.
 *
 * The credential goes in the `Access-Token` header, never the URL, but errors
 * still pass through `redactSecrets` because TikTok echoes request context.
 *
 * Reference: brain/docs/reference/tiktok/business-api/ (mirrored 2026-10-14).
 */

export const TIKTOK_API_BASE = "https://business-api.tiktok.com/open_api/v1.3";

/** Codes after which the stored credential will never work again. */
const REAUTH_CODES = new Set([40101, 40102, 40103, 40104, 40105, 40106, 40107]);

/** Codes that clear on their own: throttling and TikTok-side faults. */
const TRANSIENT_CODES = new Set([40016, 40100, 40133, 50000, 50002]);

export class TikTokApiError extends Error {
  readonly code: number;
  readonly requestId: string;

  constructor(code: number, message: string, requestId: string) {
    // The words matter: classifyFailure() in ../sync.ts routes on them, so an
    // expired token says "expired token" and reaches the reconnect message.
    const kind = REAUTH_CODES.has(code)
      ? "expired or invalid token"
      : TRANSIENT_CODES.has(code)
        ? "rate limit or temporarily unavailable"
        : "error";
    super(
      redactSecrets(`TikTok API ${kind} (code ${code}): ${message}`) +
        (requestId ? ` [request_id ${requestId}]` : ""),
    );
    this.name = "TikTokApiError";
    this.code = code;
    this.requestId = requestId;
  }

  get needsReauth(): boolean {
    return REAUTH_CODES.has(this.code);
  }
}

type Envelope<T> = {
  code?: number;
  message?: string;
  request_id?: string;
  data?: T;
};

function unwrap<T>(status: number, text: string): T {
  let body: Envelope<T>;
  try {
    body = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new Error(
      redactSecrets(`TikTok API returned HTTP ${status} and no JSON: ${text.slice(0, 200)}`),
    );
  }
  if (body.code !== 0) {
    throw new TikTokApiError(
      body.code ?? status,
      body.message ?? `HTTP ${status}`,
      body.request_id ?? "",
    );
  }
  return (body.data ?? {}) as T;
}

/** Encode a query the way TikTok reads it: scalars as-is, the rest as JSON. */
export function tiktokQuery(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    q.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  return q.toString();
}

export async function tiktokGet<T>(
  path: string,
  accessToken: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const url = `${TIKTOK_API_BASE}${path}?${tiktokQuery(params)}`;
  const { res, text } = await fetchBounded(
    url,
    { headers: { "Access-Token": accessToken } },
    { timeoutMs: READ_TIMEOUT_MS },
  );
  return unwrap<T>(res.status, text);
}

/**
 * POST a JSON body. `accessToken` is null for the OAuth endpoints, which
 * authenticate with the app's id and secret in the body instead.
 */
export async function tiktokPost<T>(
  path: string,
  accessToken: string | null,
  body: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers["Access-Token"] = accessToken;
  const { res, text } = await fetchBounded(
    `${TIKTOK_API_BASE}${path}`,
    { method: "POST", headers, body: JSON.stringify(body) },
    { timeoutMs: WRITE_TIMEOUT_MS },
  );
  return unwrap<T>(res.status, text);
}

/**
 * The developer app's id and secret. One app serves every brand and both the
 * organic and ads halves; each brand differs only in the tokens it granted.
 */
export function tiktokApp(): { appId: string; secret: string } {
  const appId = process.env.TIKTOK_APP_ID ?? "";
  const secret = process.env.TIKTOK_APP_SECRET ?? "";
  if (!appId || !secret) {
    throw new Error(
      "TIKTOK_APP_ID / TIKTOK_APP_SECRET are not set. Add them from TikTok for Business → My Apps → App Detail → Basic Information.",
    );
  }
  return { appId, secret };
}

export function tiktokAppConfigured(): boolean {
  return Boolean(process.env.TIKTOK_APP_ID && process.env.TIKTOK_APP_SECRET);
}
