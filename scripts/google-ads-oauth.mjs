#!/usr/bin/env node
// One-time helper: mint a Google Ads API refresh token via the OAuth "Desktop
// app" loopback flow. Run once, log in as a Google account that has access to
// the target Ads account, and paste the printed refresh token into the
// /admin/integrations Google Ads connect form (alongside developer token,
// client id/secret, and customer id).
//
// Usage:
//   GOOGLE_ADS_CLIENT_ID=xxx GOOGLE_ADS_CLIENT_SECRET=yyy node scripts/google-ads-oauth.mjs
// or:
//   node scripts/google-ads-oauth.mjs <client_id> <client_secret>
//
// The OAuth client MUST be of type "Desktop app" (Cloud Console → APIs &
// Services → Credentials). Loopback redirect URIs are allowed automatically for
// desktop clients, so no redirect URI needs to be registered.

import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";

const clientId = process.env.GOOGLE_ADS_CLIENT_ID ?? process.argv[2];
const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET ?? process.argv[3];

if (!clientId || !clientSecret) {
  console.error(
    "Missing client id/secret.\n" +
      "  GOOGLE_ADS_CLIENT_ID=xxx GOOGLE_ADS_CLIENT_SECRET=yyy node scripts/google-ads-oauth.mjs",
  );
  process.exit(1);
}

const SCOPE = "https://www.googleapis.com/auth/adwords";
const PORT = 8785;
const REDIRECT_URI = `http://localhost:${PORT}/`;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// PKCE — required style for installed apps; harmless otherwise.
const verifier = crypto.randomBytes(32).toString("base64url");
const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
const state = crypto.randomBytes(16).toString("hex");

const authUrl =
  `${AUTH_URL}?` +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // force a refresh_token every run
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  }).toString();

async function exchange(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token exchange ${res.status}: ${text}`);
  return JSON.parse(text);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (!url.searchParams.has("code") && !url.searchParams.has("error")) {
    res.writeHead(404).end();
    return;
  }
  const err = url.searchParams.get("error");
  if (err) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end(`OAuth error: ${err}`);
    console.error(`\nOAuth error: ${err}`);
    server.close();
    process.exit(1);
  }
  if (url.searchParams.get("state") !== state) {
    res.writeHead(400, { "Content-Type": "text/plain" }).end("State mismatch.");
    console.error("\nState mismatch — aborting.");
    server.close();
    process.exit(1);
  }
  try {
    const tokens = await exchange(url.searchParams.get("code"));
    res
      .writeHead(200, { "Content-Type": "text/plain" })
      .end("Done. Refresh token captured — return to the terminal.");
    console.log("\n✅ Refresh token:\n");
    console.log(tokens.refresh_token ?? "(none returned — re-run; consent may have been remembered)");
    console.log("\nPaste this as the refresh token in /admin/integrations → Google Ads.");
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end(String(e));
    console.error(`\n${e}`);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 200);
  }
});

server.listen(PORT, () => {
  console.log("Opening browser to authorize Google Ads access…");
  console.log("If it doesn't open, visit this URL manually:\n");
  console.log(authUrl + "\n");
  spawn("open", [authUrl], { stdio: "ignore" }).on("error", () => {});
});
