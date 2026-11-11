/**
 * TikTok account-holder tokens, as pure data. Kept free of the database so the
 * expiry arithmetic is testable without a DATABASE_URL (see account-auth.ts
 * for the half that reads and writes the connection).
 *
 * Lifetimes, from the Accounts API authentication guide:
 *   access token   1 day
 *   refresh token  1 year; after that the account holder must re-authorize.
 */

export type AccountCredentials = {
  accessToken: string;
  /** Epoch ms. */
  accessExpiresAt: number;
  refreshToken: string;
  /** Epoch ms. */
  refreshExpiresAt: number;
  /** The account's app-scoped id, passed as `business_id` everywhere. */
  openId: string;
  scope: string;
};

/** What /tt_user/oauth2/token/ and /tt_user/oauth2/refresh_token/ return. */
export type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  open_id?: string;
  scope?: string;
};

/** Refresh this long before expiry, so a token never dies mid-sync. */
export const REFRESH_MARGIN_MS = 30 * 60_000;

/** Warn an admin this long before the yearly re-authorization is due. */
export const REAUTH_WARNING_MS = 30 * 24 * 60 * 60_000;

export function credentialsFromResponse(
  r: TokenResponse,
  now = Date.now(),
  previous?: AccountCredentials,
): AccountCredentials {
  if (!r.access_token) throw new Error("TikTok token response had no access_token.");
  const refreshToken = r.refresh_token || previous?.refreshToken || "";
  if (!refreshToken) throw new Error("TikTok token response had no refresh_token.");
  return {
    accessToken: r.access_token,
    accessExpiresAt: now + (r.expires_in ?? 86_400) * 1000,
    refreshToken,
    refreshExpiresAt: r.refresh_token_expires_in
      ? now + r.refresh_token_expires_in * 1000
      : (previous?.refreshExpiresAt ?? now + 365 * 86_400_000),
    openId: r.open_id || previous?.openId || "",
    scope: r.scope ?? previous?.scope ?? "",
  };
}

export function needsRefresh(c: AccountCredentials, now = Date.now()): boolean {
  return c.accessExpiresAt - now < REFRESH_MARGIN_MS;
}

/** Whole days until the account holder must re-authorize; negative when past. */
export function daysUntilReauth(c: AccountCredentials, now = Date.now()): number {
  return Math.floor((c.refreshExpiresAt - now) / 86_400_000);
}

export function parseCredentials(json: string): AccountCredentials {
  const c = JSON.parse(json) as Partial<AccountCredentials>;
  if (!c.accessToken || !c.refreshToken || !c.openId) {
    throw new Error("Stored TikTok credentials are incomplete; reconnect the account.");
  }
  return {
    accessToken: c.accessToken,
    accessExpiresAt: Number(c.accessExpiresAt ?? 0),
    refreshToken: c.refreshToken,
    refreshExpiresAt: Number(c.refreshExpiresAt ?? 0),
    openId: c.openId,
    scope: c.scope ?? "",
  };
}

/** Scopes this integration reads with. Missing ones get named at connect time. */
export const REQUIRED_ACCOUNT_SCOPES = [
  "user.info.basic",
  "user.info.stats",
  "user.insights",
  "video.list",
  "video.insights",
] as const;

export function missingScopes(granted: string, required: readonly string[] = REQUIRED_ACCOUNT_SCOPES): string[] {
  const have = new Set(granted.split(/[,\s]+/).filter(Boolean));
  return required.filter((s) => !have.has(s));
}
