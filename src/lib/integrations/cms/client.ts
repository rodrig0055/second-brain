import { decryptSecret } from "@/lib/crypto";
import type { DbConnection } from "../types";

/**
 * A minimal MCP client for the storefront CMS endpoint (`<host>/mcp/cms`).
 *
 * The endpoint speaks stateless JSON-RPC over HTTP: no session has to be kept
 * between calls, and replies are plain JSON (an SSE reply is read too, in case
 * the server ever streams). Auth is a Sanctum bearer token from the CMS's own
 * `/api/login`. A connection stores either a fixed token or the login itself;
 * with a login the token is fetched on first use and again whenever the CMS
 * answers 401, so an expired token never needs a person.
 */

export const CMS_TENANTS = ["PH", "SG", "TH", "VN"] as const;
export type CmsTenant = (typeof CMS_TENANTS)[number];

export type CmsTarget = {
  /** https origin of the storefront, e.g. https://dev3.acmeflorals.example */
  host: string;
  tenant: CmsTenant;
  /** False for a test storefront (dev3 and the like). Shown on every card. */
  live: boolean;
};

export type CmsCredentials = { token: string } | { email: string; password: string };

export type CmsToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

export type CmsCallResult = {
  /** False when the CMS refused or the call failed (`isError`). */
  ok: boolean;
  /** The CMS's own words, all text parts joined. */
  text: string;
  /** The text parsed as JSON when it is JSON. */
  data?: unknown;
};

class CmsAuthError extends Error {}

/** "dev3.acmeflorals.example/" or "https://dev3.acmeflorals.example/mcp/cms" -> "https://dev3.acmeflorals.example". */
export function normalizeCmsHost(input: string): string {
  const raw = input.trim();
  const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  if (url.protocol !== "https:") throw new Error("The CMS host must use https.");
  return url.origin;
}

export function cmsTarget(conn: DbConnection): CmsTarget {
  const tenant = String(conn.config.tenant ?? "");
  if (!(CMS_TENANTS as readonly string[]).includes(tenant)) {
    throw new Error(`CMS connection has no valid storefront code (got "${tenant}").`);
  }
  return {
    host: normalizeCmsHost(String(conn.config.host ?? "")),
    tenant: tenant as CmsTenant,
    live: conn.config.live === true,
  };
}

function credentialsOf(conn: DbConnection): CmsCredentials {
  if (!conn.encryptedCredentials) throw new Error("CMS connection has no stored credentials.");
  return JSON.parse(decryptSecret(conn.encryptedCredentials)) as CmsCredentials;
}

/**
 * The JSON-RPC message in an HTTP reply body: the body itself for JSON, or the
 * last `data:` event that carries a result or an error for SSE.
 */
export function parseRpcBody(contentType: string, body: string): Record<string, unknown> {
  if (contentType.includes("text/event-stream")) {
    let found: Record<string, unknown> | null = null;
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const msg = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
        if ("result" in msg || "error" in msg) found = msg;
      } catch {
        // a keep-alive or partial line
      }
    }
    if (!found) throw new Error("The CMS sent an event stream with no result in it.");
    return found;
  }
  return JSON.parse(body) as Record<string, unknown>;
}

/** A `tools/call` result as text, and as JSON when the text is JSON. */
export function readCallResult(result: unknown): CmsCallResult {
  const r = (result ?? {}) as { content?: { type?: string; text?: string }[]; isError?: boolean };
  const text = (r.content ?? [])
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  return { ok: r.isError !== true, text, data };
}

let rpcId = 0;

async function rpc(
  host: string,
  token: string,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${host}/mcp/cms`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) }),
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });
  if (res.status === 401) throw new CmsAuthError("The CMS refused the token (401).");
  const body = await res.text();
  if (!res.ok) throw new Error(`CMS ${method} failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  const msg = parseRpcBody(res.headers.get("content-type") ?? "", body);
  if (msg.error) {
    const e = msg.error as { message?: string; code?: number };
    throw new Error(`CMS ${method} error ${e.code ?? ""}: ${e.message ?? "unknown"}`.trim());
  }
  return msg.result;
}

/** Log in to the CMS and return a fresh access token. */
export async function cmsLogin(host: string, email: string, password: string): Promise<string> {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  const res = await fetch(`${host}/api/login`, {
    method: "POST",
    // Without this a failed login answers with a redirect instead of a reason.
    headers: { Accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; message?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`CMS login failed (HTTP ${res.status}): ${body.message ?? "no access token returned"}`);
  }
  return body.access_token;
}

// Tokens per connection version, so saving new credentials drops the old token.
const tokenCache = new Map<string, string>();

function cacheKey(conn: DbConnection): string {
  return `${conn.id}:${new Date(conn.updatedAt).getTime()}`;
}

async function tokenFor(conn: DbConnection, host: string, fresh: boolean): Promise<string> {
  const creds = credentialsOf(conn);
  if ("token" in creds) return creds.token;
  const key = cacheKey(conn);
  const cached = tokenCache.get(key);
  if (cached && !fresh) return cached;
  const token = await cmsLogin(host, creds.email, creds.password);
  tokenCache.set(key, token);
  return token;
}

/** One JSON-RPC call for a stored connection, logging in again once on a 401. */
async function connectionRpc(
  conn: DbConnection,
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  const { host } = cmsTarget(conn);
  try {
    return await rpc(host, await tokenFor(conn, host, false), method, params);
  } catch (e) {
    if (!(e instanceof CmsAuthError) || "token" in credentialsOf(conn)) throw e;
    return rpc(host, await tokenFor(conn, host, true), method, params);
  }
}

// The tool list changes only when the CMS is deployed, so a chat does not need
// to ask for it on every message.
const TOOL_TTL_MS = 10 * 60_000;
const toolCache = new Map<string, { at: number; tools: CmsToolDef[] }>();

export async function listCmsTools(conn: DbConnection): Promise<CmsToolDef[]> {
  const key = cacheKey(conn);
  const hit = toolCache.get(key);
  if (hit && Date.now() - hit.at < TOOL_TTL_MS) return hit.tools;
  const result = (await connectionRpc(conn, "tools/list")) as { tools?: CmsToolDef[] };
  const tools = result.tools ?? [];
  toolCache.set(key, { at: Date.now(), tools });
  return tools;
}

/** Call one CMS tool. The storefront code is always added here, never by the model. */
export async function callCmsTool(
  conn: DbConnection,
  name: string,
  args: Record<string, unknown>,
): Promise<CmsCallResult> {
  const { tenant } = cmsTarget(conn);
  const result = await connectionRpc(conn, "tools/call", {
    name,
    arguments: { ...args, tenant },
  });
  return readCallResult(result);
}

/**
 * Check a host + credentials before they are saved: log in if needed, list the
 * tools, and make one read call so a wrong storefront code fails here rather
 * than in someone's chat.
 */
export async function verifyCmsCredentials(
  host: string,
  tenant: CmsTenant,
  creds: CmsCredentials,
): Promise<{ toolCount: number }> {
  const token = "token" in creds ? creds.token : await cmsLogin(host, creds.email, creds.password);
  let listed: { tools?: CmsToolDef[] };
  try {
    listed = (await rpc(host, token, "tools/list")) as { tools?: CmsToolDef[] };
  } catch (e) {
    if (e instanceof CmsAuthError) {
      throw new Error("The CMS refused these credentials. The account needs the admin role or the cms permission.");
    }
    throw e;
  }
  const toolCount = listed.tools?.length ?? 0;
  if (toolCount === 0) throw new Error("The CMS answered but offers no tools.");
  const probe = readCallResult(
    await rpc(host, token, "tools/call", { name: "cms_reference_data", arguments: { tenant } }),
  );
  if (!probe.ok) throw new Error(probe.text || "The CMS refused the storefront code.");
  return { toolCount };
}
