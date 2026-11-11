import type { DbConnection, SyncResult, SyncWindow } from "./types";
import { syncShopify } from "./shopify/sync";
import { syncMeta } from "./meta/sync";
import { syncGoogleAds } from "./google_ads/sync";
import { syncSendpulse } from "./sendpulse/sync";
import { syncMetaOrganic } from "./meta_organic/sync";
import { syncTiktokOrganic } from "./tiktok_organic/sync";
import { syncTiktokAds } from "./tiktok_ads/sync";

type Adapter = {
  /** Default lookback (days) when a connection has never synced. */
  defaultLookbackDays: number;
  /**
   * How far back an already-synced connection must be re-read every time.
   *
   * Some platforms keep changing days they already reported. Meta credits a
   * purchase to the day of the *click*, so a conversion arriving today can be
   * written back to a day up to a week ago, and a window that starts where the
   * last sync ended would never see it. Days outside this window are treated as
   * settled, which is also what lets a rule act on them.
   */
  restateDays?: number;
  sync: (conn: DbConnection, window: SyncWindow) => Promise<SyncResult>;
};

// Platform → adapter. Other platforms (ga4, meta, …) slot in here as they're built.
export const ADAPTERS: Partial<Record<DbConnection["platform"], Adapter>> = {
  shopify: { defaultLookbackDays: 60, sync: syncShopify },
  // 8 days: Meta's default click window is 7, plus a day for the account's
  // timezone running behind UTC.
  meta: { defaultLookbackDays: 30, restateDays: 8, sync: syncMeta },
  google_ads: { defaultLookbackDays: 30, restateDays: 3, sync: syncGoogleAds },
  // Organic post counters (likes, saves, reach) keep accruing for weeks after
  // publish, so a window that only covered new posts would freeze every older
  // post at whatever it had scored by its first sync. 30 days of restatement
  // is where the curve is flat enough to stop paying for it.
  meta_organic: { defaultLookbackDays: 90, restateDays: 30, sync: syncMetaOrganic },
  sendpulse: { defaultLookbackDays: 90, sync: syncSendpulse },
  // TikTok keeps 60 days of daily account data, and every count lands 24-48h
  // late. Post counters keep accruing like Instagram's, hence the same 30.
  tiktok_organic: { defaultLookbackDays: 60, restateDays: 30, sync: syncTiktokOrganic },
  // TikTok's default click attribution is 7 days and its offline data settles
  // ~48h after the day, so 9 days still moving.
  tiktok: { defaultLookbackDays: 30, restateDays: 9, sync: syncTiktokAds },
};

export function getAdapter(platform: DbConnection["platform"]): Adapter | null {
  return ADAPTERS[platform] ?? null;
}
