import assert from "node:assert/strict";
import { test } from "node:test";

import { TikTokApiError, tiktokQuery } from "./api";
import { buildAuthUrl, redirectUriFor, signState, verifyState, STATE_TTL_MS } from "./oauth";
import {
  credentialsFromResponse,
  daysUntilReauth,
  missingScopes,
  needsRefresh,
  parseCredentials,
} from "./tokens";
import { fieldsForScopes } from "../tiktok_organic/client";
import { lastSettledDay, postEngagement, profileRange } from "../tiktok_organic/shape";

const SECRET = "test-secret";
const NOW = Date.parse("2026-10-14T03:00:00Z");

test("a signed state round-trips and carries who started the connect", () => {
  const token = signState({ kind: "account", brandId: "b1", userId: "u1" }, NOW, SECRET);
  const s = verifyState(token, NOW + 1000, SECRET);
  assert.equal(s?.kind, "account");
  assert.equal(s?.brandId, "b1");
  assert.equal(s?.userId, "u1");
});

test("a tampered, foreign or expired state is refused", () => {
  const token = signState({ kind: "account", brandId: "b1", userId: "u1" }, NOW, SECRET);
  const [body, mac] = token.split(".");
  const forged = Buffer.from(
    JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), brandId: "b2" }),
  ).toString("base64url");
  assert.equal(verifyState(`${forged}.${mac}`, NOW, SECRET), null);
  assert.equal(verifyState(token, NOW, "another-secret"), null);
  assert.equal(verifyState(token, NOW + STATE_TTL_MS + 1, SECRET), null);
  assert.equal(verifyState("garbage", NOW, SECRET), null);
});

test("the auth URL keeps the portal's parameters and the redirect is read back exactly", () => {
  const base =
    "https://www.tiktok.com/v2/auth/authorize?client_key=abc&scope=user.info.basic%2Cvideo.list&response_type=code&redirect_uri=https%3A%2F%2Fapp.example%2Fapi%2Fintegrations%2Ftiktok%2Fcallback%2F";
  const url = new URL(buildAuthUrl("account", "STATE", base));
  assert.equal(url.searchParams.get("client_key"), "abc");
  assert.equal(url.searchParams.get("state"), "STATE");
  // TikTok compares this to the registered URL exactly, slash included.
  assert.equal(redirectUriFor("account", base), "https://app.example/api/integrations/tiktok/callback/");
});

test("access tokens refresh half an hour before their one-day expiry", () => {
  const c = credentialsFromResponse(
    { access_token: "a", expires_in: 86_400, refresh_token: "r", refresh_token_expires_in: 31_536_000, open_id: "o", scope: "video.list" },
    NOW,
  );
  assert.equal(needsRefresh(c, NOW), false);
  assert.equal(needsRefresh(c, NOW + 86_400_000 - 29 * 60_000), true);
  assert.equal(daysUntilReauth(c, NOW), 365);
});

test("a refresh response missing the refresh token keeps the previous one", () => {
  const prev = credentialsFromResponse(
    { access_token: "a", refresh_token: "r1", open_id: "o", scope: "s", refresh_token_expires_in: 100 },
    NOW,
  );
  const next = credentialsFromResponse({ access_token: "a2", expires_in: 86_400 }, NOW + 1, prev);
  assert.equal(next.refreshToken, "r1");
  assert.equal(next.openId, "o");
  assert.equal(next.refreshExpiresAt, prev.refreshExpiresAt);
});

test("stored credentials without an open_id are rejected rather than half-used", () => {
  assert.throws(() => parseCredentials(JSON.stringify({ accessToken: "a", refreshToken: "r" })));
});

test("missing scopes are named, in TikTok's comma-separated format", () => {
  assert.deepEqual(
    missingScopes("user.info.basic,user.info.stats,video.list"),
    ["user.insights", "video.insights"],
  );
  assert.deepEqual(missingScopes("user.info.basic,user.info.stats,user.insights,video.list,video.insights"), []);
});

test("fields are only requested for granted scopes", () => {
  const f = fieldsForScopes("video.list", {
    "video.list": ["item_id", "likes"],
    "video.insights": ["new_followers"],
  });
  assert.deepEqual(f, ["item_id", "likes"]);
});

test("query arrays and objects are sent as JSON, which is how TikTok reads them", () => {
  const q = new URLSearchParams(tiktokQuery({ business_id: "x", fields: ["item_id", "likes"], cursor: undefined }));
  assert.equal(q.get("fields"), '["item_id","likes"]');
  assert.equal(q.has("cursor"), false);
});

test("an expired-token code reads as a reauth failure to the sync classifier", () => {
  const e = new TikTokApiError(40102, "Access token has expired", "req1");
  assert.equal(e.needsReauth, true);
  assert.match(e.message, /expired or invalid token/);
  assert.equal(new TikTokApiError(40100, "Too many requests", "").needsReauth, false);
});

test("the profile range never reaches past 60 days or into today", () => {
  const now = new Date("2026-10-14T03:00:00Z");
  assert.deepEqual(profileRange({ start: "2026-01-01", end: "2026-10-14" }, now), {
    start: "2026-08-16",
    end: "2026-10-13",
  });
  assert.equal(profileRange({ start: "2026-10-14", end: "2026-10-14" }, now), null);
  assert.equal(lastSettledDay(now), "2026-10-12");
});

test("engagement counts saves, which TikTok calls favorites", () => {
  assert.equal(postEngagement({ likes: 10, comments: 2, shares: 3, favorites: 5 }), 20);
});
