import { tiktokApp, tiktokGet, tiktokPost } from "../tiktok/api";

/**
 * Marketing API reads for TikTok ad accounts ("advertisers").
 *
 * Auth is simpler than the organic side: the advertiser grant returns a
 * long-term access token that does not expire (revoked only by the user or
 * /oauth2/revoke_token/), and one token reaches every ad account the
 * authorizing user manages, so connecting picks which of them a brand owns.
 *
 * Reference: brain/docs/reference/tiktok/business-api/api-reference/{authentication,ad-accounts,reporting}/
 */

export type Advertiser = {
  advertiserId: string;
  name: string;
  currency: string;
  /** IANA name when TikTok gives one, else its GMT-offset string. */
  timezone: string;
  status: string;
};

export async function exchangeAdvertiserCode(
  authCode: string,
): Promise<{ accessToken: string; advertiserIds: string[] }> {
  const { appId, secret } = tiktokApp();
  const data = await tiktokPost<{ access_token?: string; advertiser_ids?: string[] }>(
    "/oauth2/access_token/",
    null,
    { app_id: appId, secret, auth_code: authCode },
  );
  if (!data.access_token) throw new Error("TikTok returned no advertiser access token.");
  return { accessToken: data.access_token, advertiserIds: (data.advertiser_ids ?? []).map(String) };
}

export async function fetchAdvertisers(
  accessToken: string,
  advertiserIds: string[],
): Promise<Advertiser[]> {
  const out: Advertiser[] = [];
  // /advertiser/info/ takes at most 100 ids per call.
  for (let i = 0; i < advertiserIds.length; i += 100) {
    const data = await tiktokGet<{
      list?: {
        advertiser_id: string;
        name?: string;
        currency?: string;
        timezone?: string;
        display_timezone?: string;
        status?: string;
      }[];
    }>("/advertiser/info/", accessToken, {
      advertiser_ids: advertiserIds.slice(i, i + 100),
      fields: ["advertiser_id", "name", "currency", "timezone", "display_timezone", "status"],
    });
    for (const a of data.list ?? []) {
      out.push({
        advertiserId: String(a.advertiser_id),
        name: a.name ?? String(a.advertiser_id),
        currency: a.currency ?? "USD",
        timezone: a.display_timezone || a.timezone || "UTC",
        status: a.status ?? "",
      });
    }
  }
  return out;
}

export type ReportRow = {
  dimensions: Record<string, string>;
  metrics: Record<string, string>;
};

/** Metrics every sync asks for. Strings in TikTok's response; parsed by the sync. */
export const REPORT_METRICS = [
  "spend",
  "impressions",
  "clicks",
  "reach",
  "conversion",
  // Website purchases and their value: what ROAS is computed from.
  "complete_payment",
  "total_complete_payment_rate",
  "video_play_actions",
] as const;

/**
 * A synchronous BASIC report, every page. Dates are in the ad account's own
 * time zone. With `stat_time_day` in the dimensions TikTok caps a request at
 * 30 days, so callers chunk longer windows.
 */
export async function runDailyReport(
  accessToken: string,
  advertiserId: string,
  opts: {
    dataLevel: "AUCTION_ADVERTISER" | "AUCTION_CAMPAIGN";
    start: string;
    end: string;
    extraMetrics?: string[];
  },
): Promise<ReportRow[]> {
  const dimensions =
    opts.dataLevel === "AUCTION_CAMPAIGN"
      ? ["campaign_id", "stat_time_day"]
      : ["advertiser_id", "stat_time_day"];
  const rows: ReportRow[] = [];
  for (let page = 1; page <= 50; page++) {
    const data = await tiktokGet<{
      list?: ReportRow[];
      page_info?: { page?: number; total_page?: number };
    }>("/report/integrated/get/", accessToken, {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: opts.dataLevel,
      dimensions,
      metrics: [...REPORT_METRICS, ...(opts.extraMetrics ?? [])],
      start_date: opts.start,
      end_date: opts.end,
      page,
      page_size: 1000,
    });
    rows.push(...(data.list ?? []));
    const total = data.page_info?.total_page ?? 1;
    if (page >= total) break;
  }
  return rows;
}
