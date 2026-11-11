import { decryptSecret } from "@/lib/crypto";
import {
  READ_TIMEOUT_MS,
  TOTAL_READ_TIMEOUT_MS,
  WRITE_TIMEOUT_MS,
  fetchBounded,
  redactSecrets,
} from "../http";
import type { DbConnection } from "../types";

/**
 * Upstream prose, safe to store or show.
 *
 * Redacted before it is trimmed, never after: slicing first can cut a token in
 * half and leave the front of it in the message.
 */
function upstream(text: string, max = 300): string {
  return redactSecrets(text).slice(0, max);
}

// Meta Marketing API (Graph API). We authenticate with a long-lived System User
// access token (generated in Business Settings → Users → System Users) — it does
// not expire like a user token, which suits server-side ETL.
// Marketing API versions expire on a published schedule and Meta silently
// serves a newer one once yours is gone — so a version that still "works" is
// not evidence it is still supported.
//
// v26.0 was released 2026-07-29 and is the newest (checked against
// developers.facebook.com/docs/graph-api/changelog/versions on 2026-09-24).
// v25.0 does not expire until 2028-07-29, so this bump was not a deadline: the
// write layer transcribes its field allowlists per version, and pinning them to
// the version we intend to stay on avoids doing that work twice.
//
// Checked against the v26.0 changelog before moving. Nothing this app reads was
// removed. What v26 drops, and why none of it reaches us: Instagram Explore
// placement (creatives here target feed, story and reels only), poll_spec,
// Messenger Stories, the delivery-estimate metrics, the New Pages Experience
// Page fields, and ETag/pretty/debug query parameters.
//
// One new write-time requirement, noted for the allowlists rather than for
// today: Housing, Employment and Credit/Finance ad sets with relaxable
// targeting must now set targeting_automation.advantage_audience explicitly.
// Gifting is none of those categories.
//
// No connection pins its own apiVersion, so this default governs all four.
export const DEFAULT_API_VERSION = "v26.0";
export const GRAPH = "https://graph.facebook.com";

export type MetaCreds = { accessToken: string };

export type MetaTarget = {
  accountId: string; // normalized to start with "act_"
  apiVersion: string;
  accessToken: string;
};

/** Normalize an ad account id to the `act_<digits>` form the API expects. */
export function normalizeAccountId(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed.replace(/^act_/, "")}`;
}

/**
 * The ad account a connection points at, in one place.
 *
 * Every caller has to agree on this, and the account guard most of all: a guard
 * that reads the account from one field while the write reads it from another
 * is a guard a typo walks straight through.
 */
export function accountIdOf(conn: DbConnection): string {
  return normalizeAccountId(
    String(conn.config?.adAccountId ?? conn.externalAccountId ?? ""),
  );
}

/** Resolve account id + token for a connection. */
export function resolveMetaTarget(conn: DbConnection): MetaTarget {
  if (!conn.encryptedCredentials) {
    throw new Error("Meta connection has no stored credentials.");
  }
  const creds = JSON.parse(decryptSecret(conn.encryptedCredentials)) as MetaCreds;
  const accountId = accountIdOf(conn);
  if (!accountId) throw new Error("Meta connection is missing its ad account id.");
  return {
    accountId,
    apiVersion: String(conn.config.apiVersion ?? DEFAULT_API_VERSION),
    accessToken: creds.accessToken,
  };
}

type GraphParams = Record<string, string | number | undefined>;

/**
 * The only two things a Graph call needs. Narrower than `MetaTarget` (which
 * also carries an ad account id) so the organic Page/Instagram client can share
 * this pagination without pretending it has an ad account. `MetaTarget` still
 * satisfies it structurally, so every existing call site is unchanged.
 */
export type GraphAuth = { apiVersion: string; accessToken: string };

/** A Graph API refusal, with the fields needed to decide whether to retry. */
export class MetaApiError extends Error {
  readonly code: number;
  readonly subcode: number;
  readonly isTransient: boolean;
  readonly userMessage: string;
  readonly traceId: string;
  readonly status: number;

  constructor(
    status: number,
    error: {
      message?: string;
      code?: number;
      error_subcode?: number;
      is_transient?: boolean;
      error_user_msg?: string;
      fbtrace_id?: string;
    },
  ) {
    // Redacted here rather than at each call site, because this message is
    // stored on `ad_actions.error` and shown in the workspace, and Meta echoes
    // request context (which carries the token) back inside some error bodies.
    super(redactSecrets(error.message ?? `Meta ${status}`));
    this.name = "MetaApiError";
    this.status = status;
    this.code = error.code ?? 0;
    this.subcode = error.error_subcode ?? 0;
    this.isTransient = Boolean(error.is_transient);
    // Meta's user-facing message says why in terms a person can act on, where
    // the developer message is often a generic "Invalid parameter".
    this.userMessage = redactSecrets(error.error_user_msg ?? "");
    this.traceId = error.fbtrace_id ?? "";
  }

  /**
   * Whether trying again could plausibly succeed.
   *
   * Rate limits (4, 17, 613) and Meta's own transient flag are worth retrying.
   * A permissions failure or an invalid parameter is not: retrying just spends
   * the next window's quota reaching the same conclusion.
   */
  get retryable(): boolean {
    return this.isTransient || [4, 17, 613, 2].includes(this.code);
  }
}

/**
 * POST to the Graph API, form-encoded as Meta expects.
 *
 * Separate from graphGet because the failure handling differs in kind: a failed
 * read can be retried freely, while a failed write may or may not have taken
 * effect, so the caller needs the error's code and transience to decide.
 */
export async function graphPost<T = Record<string, unknown>>(
  target: MetaTarget,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const body = new URLSearchParams({ access_token: target.accessToken });
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body.set(key, String(value));
  }

  // A write gets a deadline but never a retry: see `mutationOutcomeUnknown`.
  // Whatever this throws, the caller has to be able to tell "Meta refused"
  // from "we do not know", because only the first is safe to repeat.
  const { res, text } = await fetchBounded(
    `${GRAPH}/${target.apiVersion}/${path}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    },
    { timeoutMs: WRITE_TIMEOUT_MS },
  );
  let json: { error?: ConstructorParameters<typeof MetaApiError>[1] } & T;
  try {
    json = JSON.parse(text);
  } catch {
    throw new MetaApiError(res.status, { message: upstream(text) });
  }
  if (json.error) throw new MetaApiError(res.status, json.error);
  if (!res.ok) {
    throw new MetaApiError(res.status, { message: upstream(text) });
  }
  return json;
}

/** Read one entity's configured status and name. */
export async function fetchEntityStatus(
  target: MetaTarget,
  entityId: string,
): Promise<{ status: string; effectiveStatus: string; name: string } | null> {
  const search = new URLSearchParams({
    access_token: target.accessToken,
    fields: "name,status,effective_status",
  });
  const { res, text } = await fetchBounded(
    `${GRAPH}/${target.apiVersion}/${entityId}?${search.toString()}`,
  );
  if (!res.ok) return null;
  const json = JSON.parse(text) as {
    name?: string;
    status?: string;
    effective_status?: string;
  };
  return {
    status: json.status ?? "",
    effectiveStatus: json.effective_status ?? "",
    name: json.name ?? "",
  };
}

/**
 * Read named fields off any entity.
 *
 * `fetchEntityStatus` answers the one question pausing needs. A budget or
 * schedule change needs whichever fields it is about, both before writing (has
 * somebody moved this since it was proposed) and after (did the value land).
 *
 * Field names are restricted to what Meta's own fields grammar allows, because
 * they arrive from a stored payload rather than from a literal in this file.
 */
export async function fetchEntityFields(
  target: MetaTarget,
  entityId: string,
  fields: string[],
): Promise<Record<string, string> | null> {
  const safe = fields.filter((f) => /^[a-z][a-z0-9_]{0,63}$/.test(f));
  if (safe.length === 0) return null;
  const search = new URLSearchParams({
    access_token: target.accessToken,
    fields: safe.join(","),
  });
  const { res, text } = await fetchBounded(
    `${GRAPH}/${target.apiVersion}/${entityId}?${search.toString()}`,
  );
  if (!res.ok) return null;
  const json = JSON.parse(text) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const name of safe) {
    const value = json[name];
    if (value === undefined || value === null) continue;
    out[name] = typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  return out;
}

/**
 * Turn an ad on or off.
 *
 * Sets `status`, the ad's own switch, never `effective_status`, which is
 * computed by Meta from this ad plus its ad set and campaign and is not
 * writable. Pausing an ad whose ad set is already paused is accepted and
 * changes nothing visible, which is why the executor reports what Meta said
 * rather than assuming delivery stopped because the call returned 200.
 */
export async function setAdStatus(
  target: MetaTarget,
  adId: string,
  status: "ACTIVE" | "PAUSED",
): Promise<{ success: boolean }> {
  return graphPost<{ success: boolean }>(target, adId, { status });
}

/** GET a Graph API node/edge, following cursor pagination up to `maxPages`. */
export async function graphGet<T = Record<string, unknown>>(
  target: GraphAuth,
  path: string,
  params: GraphParams = {},
  maxPages = 25,
): Promise<T[]> {
  const base = `${GRAPH}/${target.apiVersion}/${path}`;
  const search = new URLSearchParams({ access_token: target.accessToken });
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, String(v));
  }

  const out: T[] = [];
  let url: string | null = `${base}?${search.toString()}`;
  let pages = 0;
  // A per-request deadline alone still allows 25 pages × 30s, so the walk gets
  // its own. Whatever has been collected by then is discarded rather than
  // returned short, because a partial page set reads as a real answer.
  const deadline = Date.now() + TOTAL_READ_TIMEOUT_MS;

  while (url && pages < maxPages) {
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(
        `Meta did not finish ${path} within ${TOTAL_READ_TIMEOUT_MS / 1000}s ` +
          `(${pages} pages read). Narrow the date range or the breakdown.`,
      );
    }
    const { res, text } = await fetchBounded(
      url,
      {},
      { timeoutMs: Math.min(READ_TIMEOUT_MS, left) },
    );
    if (!res.ok) {
      throw new Error(`Meta ${res.status}: ${upstream(text, 500)}`);
    }
    const json = JSON.parse(text) as {
      data?: T[];
      error?: { message?: string };
      paging?: { next?: string };
    };
    if (json.error) {
      throw new Error(
        `Meta API error: ${upstream(json.error.message ?? JSON.stringify(json.error), 500)}`,
      );
    }
    if (Array.isArray(json.data)) out.push(...json.data);
    url = nextPage(json.paging?.next);
    pages++;
  }
  return out;
}

/**
 * The next cursor, but only if Meta handed back a URL we are willing to send
 * the token to.
 *
 * `paging.next` is an absolute URL from the response body with the access token
 * already in it, and following it is how pagination works. Checking the scheme
 * and host before doing so means an unexpected value in that field cannot turn
 * a read into a credential delivery.
 */
function nextPage(next: string | undefined): string | null {
  if (!next) return null;
  try {
    const url = new URL(next);
    if (url.protocol !== "https:") return null;
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Lightweight connectivity check — returns the ad account's name/currency/timezone. */
export async function metaAccountInfo(
  target: MetaTarget,
): Promise<{ name: string; currency: string; timezone: string }> {
  const search = new URLSearchParams({
    access_token: target.accessToken,
    fields: "name,currency,timezone_name",
  });
  const { res, text } = await fetchBounded(
    `${GRAPH}/${target.apiVersion}/${target.accountId}?${search.toString()}`,
  );
  if (!res.ok) throw new Error(`Meta ${res.status}: ${upstream(text, 500)}`);
  const json = JSON.parse(text) as {
    name?: string;
    currency?: string;
    timezone_name?: string;
    error?: { message?: string };
  };
  if (json.error) throw new Error(`Meta API error: ${upstream(json.error.message ?? "", 500)}`);
  return {
    name: json.name ?? target.accountId,
    currency: json.currency ?? "USD",
    timezone: json.timezone_name ?? "UTC",
  };
}

/** Mint nothing — just verify a raw token + account work, returning account info. */
export async function verifyMetaCredentials(
  accessToken: string,
  adAccountId: string,
): Promise<{ name: string; currency: string; timezone: string }> {
  const target: MetaTarget = {
    accountId: normalizeAccountId(adAccountId),
    apiVersion: DEFAULT_API_VERSION,
    accessToken,
  };
  return metaAccountInfo(target);
}

/**
 * Whether this token can actually change things on this ad account.
 *
 * Reading and writing need different permissions, and Meta reports a missing
 * one as an ordinary failure at the moment you try to use it. Checking up front
 * means the admin form can name what is missing instead of someone discovering
 * it when a pause button quietly does nothing.
 */
export async function verifyMetaWriteAccess(
  accessToken: string,
  adAccountId: string,
  pageId?: string,
): Promise<{
  ok: boolean;
  missing: string[];
  scopes: string[];
  tasks: string[];
  instagramUserId: string;
  pageName: string;
}> {
  const accountId = normalizeAccountId(adAccountId);
  const missing: string[] = [];

  const debug = await fetchBounded(
    `${GRAPH}/${DEFAULT_API_VERSION}/debug_token?input_token=${encodeURIComponent(
      accessToken,
    )}&access_token=${encodeURIComponent(accessToken)}`,
  )
    .then(({ text }) => JSON.parse(text) as { data?: { scopes?: string[] } })
    .catch(() => ({ data: undefined }));
  const scopes = debug.data?.scopes ?? [];
  if (!scopes.includes("ads_management")) missing.push("ads_management");

  // The account has to be assigned to this system user with a task that
  // permits changes, not only one that permits reading.
  const accounts = await fetchBounded(
    `${GRAPH}/${DEFAULT_API_VERSION}/me/adaccounts?fields=account_id,user_tasks&limit=200&access_token=${encodeURIComponent(
      accessToken,
    )}`,
  )
    .then(
      ({ text }) =>
        JSON.parse(text) as {
          data?: { account_id?: string; user_tasks?: string[] }[];
        },
    )
    .catch(() => ({ data: [] }));
  const bare = accountId.replace(/^act_/, "");
  const match = (accounts.data ?? []).find((a) => a.account_id === bare);
  const tasks = match?.user_tasks ?? [];
  if (!match) missing.push(`ad account ${accountId} is not assigned to this system user`);
  else if (!tasks.some((t) => t === "MANAGE" || t === "ADVERTISE")) {
    missing.push(`ad account task MANAGE or ADVERTISE (has ${tasks.join(", ") || "none"})`);
  }

  // Creating an ad needs a Page to run it as; pausing does not.
  let instagramUserId = "";
  let pageName = "";
  if (pageId) {
    const page = await fetchBounded(
      `${GRAPH}/${DEFAULT_API_VERSION}/${pageId}?fields=name,instagram_business_account{id,username}&access_token=${encodeURIComponent(
        accessToken,
      )}`,
    )
      .then(
        ({ text }) =>
          JSON.parse(text) as {
            name?: string;
            instagram_business_account?: { id?: string };
            error?: { message?: string };
          },
      )
      .catch(() => ({
        name: undefined,
        instagram_business_account: undefined,
        error: { message: "unreachable" },
      }));
    if (page.error || !page.name) {
      missing.push(`Page ${pageId} is not reachable with this token`);
    } else {
      pageName = page.name;
      instagramUserId = page.instagram_business_account?.id ?? "";
    }
  }

  return { ok: missing.length === 0, missing, scopes, tasks, instagramUserId, pageName };
}

// ---- Insights ----

/** Meta returns counted events as `{action_type, value}` lists, not scalars. */
export type ActionStat = { action_type: string; value: string };

export type InsightRow = {
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  inline_link_clicks?: string;
  /** A list, not a number: `[{action_type: "outbound_click", value: "12"}]`. */
  outbound_clicks?: ActionStat[];
  ctr?: string;
  cpc?: string;
  reach?: string;
  frequency?: string;
  actions?: ActionStat[];
  action_values?: ActionStat[];
  /** Plays to completion. Its own field, not an entry in `actions`. */
  video_thruplay_watched_actions?: ActionStat[];
  /**
   * Video plays. `video_3_sec_watched_actions` was the field for this and is
   * REMOVED as of v25.0 — asking for it fails the whole insights call with
   * "(#100) … is not valid for fields param", which takes every other metric in
   * the request down with it. `video_play_actions` is the supported field.
   */
  video_play_actions?: ActionStat[];
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
};

const INSIGHT_FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "inline_link_clicks",
  // The doc's CTR and LPVr are outbound ones, and outbound clicks are a
  // different number from both `clicks` and `inline_link_clicks`.
  "outbound_clicks",
  "ctr",
  "cpc",
  "reach",
  "frequency",
  "actions",
  "action_values",
  "video_thruplay_watched_actions",
  "video_play_actions",
  "campaign_id",
  "campaign_name",
  // Funnel is an ad set property for Bloomly PH, whose MOF ad set lives inside
  // the TOF campaign — so campaign_id alone cannot say which funnel a row is.
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
].join(",");

export type InsightLevel = "account" | "campaign" | "adset" | "ad";

/**
 * Pull daily insight rows for a window at a given level.
 * `time_increment=1` returns one row per day per entity.
 */
export async function fetchInsights(
  target: MetaTarget,
  level: InsightLevel,
  startDate: string,
  endDate: string,
): Promise<InsightRow[]> {
  return graphGet<InsightRow>(target, `${target.accountId}/insights`, {
    level,
    fields: INSIGHT_FIELDS,
    time_increment: 1,
    time_range: JSON.stringify({ since: startDate, until: endDate }),
    limit: 500,
  });
}

// ---- Creatives ----

// Raw shape of the ad + nested creative as returned by the Graph API.
type RawAd = {
  id?: string;
  name?: string;
  effective_status?: string;
  status?: string;
  created_time?: string;
  adset?: { id?: string; name?: string };
  campaign?: { id?: string; name?: string; objective?: string };
  creative?: {
    id?: string;
    object_type?: string; // VIDEO | SHARE | PHOTO | …
    image_url?: string;
    thumbnail_url?: string;
    video_id?: string;
    body?: string;
    title?: string;
    call_to_action_type?: string;
    object_story_spec?: {
      link_data?: {
        message?: string;
        name?: string;
        description?: string;
        call_to_action?: { type?: string };
        child_attachments?: unknown[];
      };
      video_data?: {
        message?: string;
        title?: string;
        video_id?: string;
        call_to_action?: { type?: string };
      };
    };
  };
};

/** A creative normalized into the fields the classifier + dashboards consume. */
export type NormalizedCreative = {
  adId: string;
  adName: string;
  campaignId: string;
  campaignName: string;
  objective: string;
  /** What Meta is doing with it, which a paused parent can override. */
  effectiveStatus: string;
  /** What the ad itself is set to. */
  configuredStatus: string;
  adsetId: string;
  adsetName: string;
  createdTime: string;
  mediaType: "image" | "video" | "carousel";
  imageUrl: string | null;
  thumbnailUrl: string | null;
  videoId: string | null;
  body: string;
  title: string;
  callToAction: string;
};

const AD_CREATIVE_FIELDS = [
  "name",
  "effective_status",
  // What the ad itself says, as distinct from what Meta is doing with it: an
  // ACTIVE ad inside a paused ad set is not running, and only the pair tells
  // you which of the two to go and fix.
  "status",
  "created_time",
  "adset{id,name}",
  "campaign{id,name,objective}",
  "creative{id,object_type,image_url,thumbnail_url,video_id,body,title," +
    "call_to_action_type,object_story_spec}",
].join(",");

/**
 * Fetch ad + creative details by id, 50 at a time through the Graph Batch API.
 *
 * This used the `?ids=` form until Meta removed it: from v26.0 every such
 * request fails with "The ids query parameter is deprecated", which left the
 * nightly creative refresh writing nothing. A batch is one POST carrying up to
 * 50 GETs, each answered on its own, so a deleted ad fails alone instead of
 * taking the rest of its chunk with it.
 */
export async function fetchAdsByIds(
  target: MetaTarget,
  adIds: string[],
): Promise<NormalizedCreative[]> {
  const out: NormalizedCreative[] = [];
  for (let i = 0; i < adIds.length; i += 50) {
    const chunk = adIds.slice(i, i + 50);
    if (chunk.length === 0) continue;
    out.push(...(await fetchAdBatch(target, chunk)));
  }
  return out;
}

type BatchReply = { code?: number; body?: string } | null;

async function fetchAdBatch(target: MetaTarget, ids: string[]): Promise<NormalizedCreative[]> {
  const fields = encodeURIComponent(AD_CREATIVE_FIELDS);
  const body = new URLSearchParams({
    access_token: target.accessToken,
    include_headers: "false",
    batch: JSON.stringify(
      ids.map((id) => ({ method: "GET", relative_url: `${id}?fields=${fields}` })),
    ),
  });
  const { res, text } = await fetchBounded(`${GRAPH}/${target.apiVersion}/`, {
    method: "POST",
    body,
  });
  let replies: BatchReply[] | { error?: { message?: string } };
  try {
    replies = JSON.parse(text);
  } catch {
    throw new Error(`Meta ${res.status}: ${upstream(text, 500)}`);
  }
  // A failure of the batch as a whole (a bad token, a rate limit) is an error;
  // a failure of one GET inside it is that ad's problem only.
  if (!res.ok || !Array.isArray(replies)) {
    const message = Array.isArray(replies) ? text : (replies.error?.message ?? text);
    throw new Error(`Meta ${res.status}: ${upstream(message, 500)}`);
  }

  const out: NormalizedCreative[] = [];
  replies.forEach((reply, i) => {
    let raw: (RawAd & { error?: { message?: string } }) | null = null;
    try {
      raw = reply?.body ? JSON.parse(reply.body) : null;
    } catch {
      raw = null;
    }
    if (reply?.code === 200 && raw?.id) {
      out.push(normalizeCreative(raw));
    } else {
      // Normally a deleted ad. Logged so that a systematic failure (a bad
      // field, say) shows up in the cron's logs instead of as silence.
      console.warn(
        `[meta] ad ${ids[i]} skipped: ${reply?.code ?? "no reply"} ${upstream(raw?.error?.message ?? "", 200)}`,
      );
    }
  });
  return out;
}

/**
 * Pull the iframe URL out of the HTML snippet Meta returns for a preview.
 *
 * The host check is the point. Meta hands back a blob of HTML, and it is about
 * to be put in an iframe src, so the URL is validated to be https and on
 * facebook.com before it goes anywhere near the page.
 *
 * Adapted from github.com/zernio-dev/ads-dashboard (MIT, © 2026 Zernio); see
 * THIRD_PARTY_NOTICES.md.
 */
export function extractPreviewSrc(html: string): string | null {
  const match = /<iframe[^>]*\ssrc=["']([^"']+)["']/i.exec(html);
  if (!match) return null;
  const src = match[1].replace(/&amp;/g, "&");
  try {
    const url = new URL(src);
    if (url.protocol !== "https:") return null;
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** The placements we will ask Meta to render a preview for. */
export const META_PREVIEW_FORMATS = [
  "MOBILE_FEED_STANDARD",
  "DESKTOP_FEED_STANDARD",
  "INSTAGRAM_STANDARD",
  "INSTAGRAM_STORY",
] as const;
export type MetaPreviewFormat = (typeof META_PREVIEW_FORMATS)[number];

/**
 * Meta's own rendering of an ad, as a URL to embed.
 *
 * This is the real ad as it appears in the feed, not our reconstruction of it
 * from an image and some text: it carries the page name, the call to action
 * button and the cropping each placement applies.
 */
export async function fetchAdPreview(
  target: MetaTarget,
  adId: string,
  adFormat: MetaPreviewFormat = "MOBILE_FEED_STANDARD",
): Promise<string | null> {
  const rows = await graphGet<{ body?: string }>(
    target,
    `${adId}/previews`,
    { ad_format: adFormat },
    1,
  );
  for (const row of rows) {
    if (!row.body) continue;
    const src = extractPreviewSrc(row.body);
    if (src) return src;
  }
  return null;
}

/** Resolve a video's temporary downloadable source URL (`source` field). */
export async function fetchVideoSource(
  target: MetaTarget,
  videoId: string,
): Promise<string | null> {
  const search = new URLSearchParams({
    access_token: target.accessToken,
    fields: "source",
  });
  const { res, text } = await fetchBounded(
    `${GRAPH}/${target.apiVersion}/${videoId}?${search.toString()}`,
  );
  if (!res.ok) return null;
  const json = JSON.parse(text) as { source?: string; error?: unknown };
  return json.source ?? null;
}

/**
 * Flatten a raw ad+creative into the fields we store/classify. Link and video
 * ads nest their copy inside `object_story_spec` rather than the top-level
 * `body`/`title`, so fall back to that. Media type is inferred from the
 * creative's `object_type`, a `video_id`, or the presence of carousel children.
 */
export function normalizeCreative(raw: RawAd): NormalizedCreative {
  const c = raw.creative ?? {};
  const spec = c.object_story_spec ?? {};
  const link = spec.link_data ?? {};
  const video = spec.video_data ?? {};

  const videoId = c.video_id ?? video.video_id ?? null;
  const isCarousel =
    Array.isArray(link.child_attachments) && link.child_attachments.length > 0;
  const mediaType: NormalizedCreative["mediaType"] = videoId
    ? "video"
    : isCarousel
      ? "carousel"
      : "image";

  const body = c.body || link.message || video.message || link.description || "";
  const title = c.title || link.name || video.title || "";
  const callToAction =
    c.call_to_action_type ||
    link.call_to_action?.type ||
    video.call_to_action?.type ||
    "";

  return {
    adId: String(raw.id ?? ""),
    adName: raw.name ?? "",
    campaignId: raw.campaign?.id ?? "",
    campaignName: raw.campaign?.name ?? "",
    objective: raw.campaign?.objective ?? "",
    effectiveStatus: raw.effective_status ?? "",
    configuredStatus: raw.status ?? "",
    adsetId: raw.adset?.id ?? "",
    adsetName: raw.adset?.name ?? "",
    createdTime: raw.created_time ?? "",
    mediaType,
    imageUrl: c.image_url ?? null,
    thumbnailUrl: c.thumbnail_url ?? null,
    videoId,
    body,
    title,
    callToAction,
  };
}

/** Extract a conversion count + value from an insight row's `actions` arrays. */
export function extractConversions(row: InsightRow): {
  conversions: number;
  conversionValue: number;
} {
  // Pick the most canonical purchase signal in priority order. `omni_purchase`
  // is Meta's de-duplicated total (online + offline + app); fall back to the
  // pixel purchase, then any other "*purchase" action type.
  const pick = (arr?: { action_type: string; value: string }[]) => {
    if (!arr) return 0;
    const byType = (t: string) => arr.find((a) => a.action_type === t);
    const chosen =
      byType("omni_purchase") ??
      byType("offsite_conversion.fb_pixel_purchase") ??
      byType("purchase") ??
      arr.find((a) => a.action_type.endsWith("purchase"));
    return chosen ? Number(chosen.value) : 0;
  };
  return {
    conversions: pick(row.actions),
    conversionValue: pick(row.action_values),
  };
}
