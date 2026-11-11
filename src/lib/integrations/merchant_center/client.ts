import { createSign } from "node:crypto";

// Google Merchant API (v1). Auth reuses the shared service account
// (GCP_SERVICE_ACCOUNT_JSON, the same one GA4 and BigQuery use). That account
// is Admin on your advanced account, which reaches every sub-account, and its
// Cloud project must be registered for the Merchant API on one of them. Registration is per project, not per call, so any
// account the service account can see works here.
//
// No SDK: a service-account JWT is exchanged for an access token by hand, which
// keeps this to plain fetch and avoids a new dependency.

const BASE = "https://merchantapi.googleapis.com";
const SCOPE = "https://www.googleapis.com/auth/content";

type ServiceAccount = { client_email: string; private_key: string };

let cached: { token: string; expiresAt: number } | null = null;

function loadServiceAccount(): ServiceAccount {
  const raw = process.env.GCP_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is not set — Merchant Center tools are unavailable.");
  }
  const json = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const sa = JSON.parse(json) as Partial<ServiceAccount>;
  if (!sa.client_email || !sa.private_key) {
    throw new Error("GCP_SERVICE_ACCOUNT_JSON is missing client_email or private_key.");
  }
  return sa as ServiceAccount;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Local development only: the service-account key lives in Vercel and is never
 * on a laptop, so `next dev` can borrow a short-lived token by impersonating the
 * account through the developer's own gcloud login (needs "Service Account
 * Token Creator" on it). Set MERCHANT_DEV_IMPERSONATE to the account's email.
 */
async function devImpersonationToken(): Promise<string | null> {
  const sa = process.env.MERCHANT_DEV_IMPERSONATE;
  if (process.env.NODE_ENV === "production" || !sa || process.env.GCP_SERVICE_ACCOUNT_JSON) return null;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { stdout } = await promisify(execFile)("gcloud", [
    "auth",
    "print-access-token",
    `--impersonate-service-account=${sa}`,
    `--scopes=${SCOPE}`,
  ]);
  return stdout.trim() || null;
}

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const dev = await devImpersonationToken();
  if (dev) {
    cached = { token: dev, expiresAt: Date.now() + 30 * 60_000 };
    return dev;
  }
  const sa = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(`Merchant API auth failed: ${body.error ?? res.status}`);
  }
  cached = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export class MerchantApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** One Merchant API call. Throws MerchantApiError with Google's message on failure. */
export async function merchantFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : {};
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } }).error?.message ?? `HTTP ${res.status}`;
    throw new MerchantApiError(res.status, msg);
  }
  return json as T;
}

// ---- Types (only the fields we use) ----

export type TakeFrom = { self?: boolean; supplementalDataSourceName?: string };

export type DataSource = {
  name: string;
  dataSourceId?: string;
  displayName?: string;
  input?: string; // API | FILE | UI | AUTOFEED
  primaryProductDataSource?: {
    feedLabel?: string;
    contentLanguage?: string;
    defaultRule?: { takeFromDataSources?: TakeFrom[] };
  };
  supplementalProductDataSource?: Record<string, unknown>;
};

export type Product = {
  name: string; // accounts/{a}/products/{lang~label~offer}
  offerId: string;
  contentLanguage: string;
  feedLabel: string;
  dataSource: string;
  productAttributes?: { title?: string; link?: string; availability?: string };
  productStatus?: {
    itemLevelIssues?: { code?: string; severity?: string; description?: string }[];
  };
};

// ---- Calls ----

export async function listDataSources(account: string): Promise<DataSource[]> {
  const out: DataSource[] = [];
  let pageToken: string | undefined;
  do {
    const page = await merchantFetch<{ dataSources?: DataSource[]; nextPageToken?: string }>(
      `datasources/v1/accounts/${account}/dataSources`,
      { query: { pageSize: "100", ...(pageToken ? { pageToken } : {}) } },
    );
    out.push(...(page.dataSources ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export async function getDataSource(name: string): Promise<DataSource> {
  return merchantFetch<DataSource>(`datasources/v1/${name}`);
}

export async function createSupplementalApiSource(
  account: string,
  displayName: string,
): Promise<DataSource> {
  return merchantFetch<DataSource>(`datasources/v1/accounts/${account}/dataSources`, {
    method: "POST",
    body: { displayName, supplementalProductDataSource: {} },
  });
}

export async function setPrimaryDefaultRule(
  primaryName: string,
  takeFromDataSources: TakeFrom[],
): Promise<DataSource> {
  return merchantFetch<DataSource>(`datasources/v1/${primaryName}`, {
    method: "PATCH",
    query: { updateMask: "primaryProductDataSource.defaultRule" },
    body: { primaryProductDataSource: { defaultRule: { takeFromDataSources } } },
  });
}

export async function deleteDataSource(name: string): Promise<void> {
  await merchantFetch(`datasources/v1/${name}`, { method: "DELETE" });
}

/** Up to `max` products, in pages of 250. */
export async function listProducts(account: string, max = 1000): Promise<Product[]> {
  const out: Product[] = [];
  let pageToken: string | undefined;
  do {
    const page = await merchantFetch<{ products?: Product[]; nextPageToken?: string }>(
      `products/v1/accounts/${account}/products`,
      { query: { pageSize: "250", ...(pageToken ? { pageToken } : {}) } },
    );
    out.push(...(page.products ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && out.length < max);
  return out.slice(0, max);
}

/** The `{lang~label~offer}` key, base64url-encoded when a part contains / % or ~. */
export function productKey(contentLanguage: string, feedLabel: string, offerId: string): string {
  const raw = `${contentLanguage}~${feedLabel}~${offerId}`;
  const parts = [contentLanguage, feedLabel, offerId];
  return parts.some((p) => /[/%~]/.test(p)) ? Buffer.from(raw).toString("base64url") : raw;
}

export async function getProduct(account: string, key: string): Promise<Product> {
  return merchantFetch<Product>(`products/v1/accounts/${account}/products/${key}`);
}

/** Write a title-only input into a SUPPLEMENTAL source. Never call with a primary source. */
export async function insertTitleInput(
  account: string,
  dataSource: string,
  p: { offerId: string; contentLanguage: string; feedLabel: string; title: string },
): Promise<void> {
  await merchantFetch(`products/v1/accounts/${account}/productInputs:insert`, {
    method: "POST",
    query: { dataSource },
    body: {
      offerId: p.offerId,
      contentLanguage: p.contentLanguage,
      feedLabel: p.feedLabel,
      productAttributes: { title: p.title },
    },
  });
}

export async function deleteInput(account: string, dataSource: string, key: string): Promise<void> {
  await merchantFetch(`products/v1/accounts/${account}/productInputs/${key}`, {
    method: "DELETE",
    query: { dataSource },
  });
}
