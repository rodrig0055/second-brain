// SendPulse Bulk Email API client. Auth is a single account-wide permanent API
// key (SENDPULSE_API_KEY, format `sp_apikey_…`) passed as a Bearer token — no
// OAuth token refresh needed. The key is shared like the GA4 service account;
// brands are distinguished by the campaign sender email's domain (see
// `campaignDomain`), which matches each brand's `domain` field.
const BASE = "https://api.sendpulse.com";

/**
 * Bearer token for a request.
 *
 * The permanent API key is the configured path and takes precedence. OAuth
 * client credentials are accepted as a fallback so the same code runs where
 * only those are available — the Wrapped pipeline has used them against this
 * account since 2026-07. Tokens are cached until shortly before expiry.
 */
let oauth: { token: string; expiresAt: number } | null = null;

async function oauthToken(): Promise<string> {
  const id = process.env.SENDPULSE_CLIENT_ID;
  const secret = process.env.SENDPULSE_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error(
      "No SendPulse credentials — set SENDPULSE_API_KEY, or SENDPULSE_CLIENT_ID and SENDPULSE_CLIENT_SECRET.",
    );
  }
  if (oauth && Date.now() < oauth.expiresAt) return oauth.token;

  const res = await fetch(`${BASE}/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: id, client_secret: secret }),
  });
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("SendPulse OAuth did not return a token.");
  oauth = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 120) * 1000,
  };
  return oauth.token;
}

async function bearer(): Promise<string> {
  const key = process.env.SENDPULSE_API_KEY;
  return key ? key.trim() : oauthToken();
}

/** True when some SendPulse credential is present (non-throwing gate). */
export function hasSendpulseKey(): boolean {
  return !!(
    process.env.SENDPULSE_API_KEY ||
    (process.env.SENDPULSE_CLIENT_ID && process.env.SENDPULSE_CLIENT_SECRET)
  );
}

async function spGet<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }
  const qs = search.toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${await bearer()}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`SendPulse ${res.status}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`SendPulse: non-JSON response for ${path}: ${text.slice(0, 200)}`);
  }
}

/**
 * The only write this client performs.
 *
 * Kept separate from `spGet` and deliberately narrow: creating a template is
 * inert — it stores HTML in the account and sends nothing — whereas
 * `POST /campaigns` actually mails people and is intentionally not implemented
 * here. A human creates and sends the campaign from the template in SendPulse.
 */
async function spPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await bearer()}`,
      "content-type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SendPulse ${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`SendPulse: non-JSON response for ${path}: ${text.slice(0, 200)}`);
  }
}

/**
 * Store an email as a reusable template and return its numeric id.
 *
 * Use `real_id`, not the hash `id`: hash ids go stale and stop resolving, which
 * cost the Wrapped send a debugging round. Note that templates CANNOT be
 * removed through the API — `DELETE /template/{id}` answers 405 — so a template
 * created here is permanent until someone deletes it in the SendPulse UI. Name
 * them so a human can tell what they are.
 */
export async function createTemplate(
  name: string,
  html: string,
  lang = "en",
): Promise<number> {
  const res = await spPost<{ result?: boolean; real_id?: number }>("/template", {
    name,
    body: Buffer.from(html, "utf8").toString("base64"),
    lang,
  });
  if (!res.real_id) throw new Error("SendPulse accepted the template but returned no id.");
  return res.real_id;
}

// ---- Types (only the fields we rely on; responses carry more) ----

export type CampaignSummary = {
  id: number;
  name?: string;
  status?: number;
  send_date?: string; // "YYYY-MM-DD HH:mm:ss" in the account timezone
  all_email_qty?: number;
  message?: { sender_name?: string; sender_email?: string; subject?: string };
};

type GeneralStat = { code: number; count: number; explain?: string };
export type CampaignDetail = CampaignSummary & {
  statistics?: { general?: GeneralStat[] };
};

/** Parsed, human-meaningful counts pulled from `statistics.general[]`. */
export type CampaignStats = {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  bounced: number;
};

// statistics.general codes (see the bulk-email OpenAPI):
//   1 Sent · 2 Delivered · 3 Opened · 4 Link redirected (click) · 5/15 Unsub ·
//   6/8/12/14 delivery failures/bounces.
export function parseStats(detail: CampaignDetail): CampaignStats {
  const g = detail.statistics?.general ?? [];
  const count = (code: number) => g.find((s) => s.code === code)?.count ?? 0;
  return {
    sent: count(1) || Number(detail.all_email_qty ?? 0),
    delivered: count(2),
    opened: count(3),
    clicked: count(4),
    unsubscribed: count(5) + count(15),
    bounced: count(6) + count(8) + count(12) + count(14),
  };
}

/** Lowercased domain of a campaign's sender email, or "" if absent. */
export function campaignDomain(c: CampaignSummary): string {
  const email = c.message?.sender_email ?? "";
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

/** The date part (YYYY-MM-DD) of a campaign's send_date, or "" if unsent. */
export function campaignDate(c: CampaignSummary): string {
  return (c.send_date ?? "").slice(0, 10);
}

export async function listCampaigns(
  limit: number,
  offset: number,
  order: "asc" | "desc" = "desc",
): Promise<CampaignSummary[]> {
  return spGet<CampaignSummary[]>("/campaigns", { limit, offset, order });
}

export async function getCampaign(id: number): Promise<CampaignDetail> {
  return spGet<CampaignDetail>(`/campaigns/${id}`);
}

/** One clicked link and how many clicks it took. */
export type CampaignReferral = { link: string; link_id?: number; count: number };

/**
 * Per-link click counts for a campaign.
 *
 * This is the data behind the "Contents with Highest Clicks" column the team
 * keeps by hand. Links come back with SendPulse's own tracking parameters
 * appended and HTML-escaped ampersands, so callers must normalise before
 * matching them against anything.
 */
export async function getCampaignReferrals(id: number): Promise<CampaignReferral[]> {
  return spGet<CampaignReferral[]>(`/campaigns/${id}/referrals`);
}

/** Connectivity check used by the connect flow — throws if the key is bad. */
export async function verifySendpulse(): Promise<{ ok: true }> {
  await spGet<unknown>("/addressbooks", { limit: 1 });
  return { ok: true };
}

export type BrandCampaign = CampaignSummary & { stats: CampaignStats; date: string };

/**
 * Fetch a brand's campaigns (by sender-email domain) sent within an inclusive
 * date range, newest-first, with per-campaign stats. Pages `/campaigns` in
 * descending send order and stops once it passes the start of the window, so
 * cost is bounded by how many campaigns the account sent in the range — not by
 * total history. `maxCampaigns` caps detail lookups as a safety net.
 */
export async function fetchBrandCampaigns(
  domain: string,
  startDate: string,
  endDate: string,
  maxCampaigns = 200,
): Promise<BrandCampaign[]> {
  const want = domain.trim().toLowerCase();
  const page = 100;
  const matched: CampaignSummary[] = [];

  for (let offset = 0; offset < 5000; offset += page) {
    const batch = await listCampaigns(page, offset, "desc");
    if (batch.length === 0) break;

    let passedWindow = false;
    for (const c of batch) {
      const d = campaignDate(c);
      if (!d) continue; // unsent / draft
      if (d > endDate) continue; // newer than window — keep paging back
      if (d < startDate) {
        passedWindow = true; // desc order: everything after this is older
        break;
      }
      if (campaignDomain(c) === want) matched.push(c);
    }
    if (passedWindow || batch.length < page) break;
    if (matched.length >= maxCampaigns) break;
  }

  const capped = matched.slice(0, maxCampaigns);
  const out: BrandCampaign[] = [];
  for (const c of capped) {
    const detail = await getCampaign(c.id);
    out.push({ ...c, date: campaignDate(c), stats: parseStats(detail) });
  }
  return out;
}
