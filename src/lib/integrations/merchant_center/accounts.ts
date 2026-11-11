import type { TakeFrom } from "./client";

/**
 * Merchant Center accounts per brand, from MERCHANT_CENTER_ACCOUNTS (JSON):
 *
 *   {"acme-florals":[{"id":"1234567","label":"Acme Florals","live":true}]}
 *
 * Ids are not secrets; they live in config so a fork needs no code change.
 * `live: false` marks an account that serves nothing (every product already
 * disapproved). Title overrides are tested there first, so a mistake costs no
 * traffic.
 */
export type MerchantAccount = { id: string; label: string; live: boolean };

function accounts(): Record<string, MerchantAccount[]> {
  const raw = process.env.MERCHANT_CENTER_ACCOUNTS;
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, MerchantAccount[]>;
  } catch {
    console.warn("MERCHANT_CENTER_ACCOUNTS is not valid JSON; Merchant Center tools are off.");
    return {};
  }
}

export function merchantAccountsFor(brandSlug: string): MerchantAccount[] {
  return accounts()[brandSlug] ?? [];
}

/** The account if it belongs to the brand, else null (never trust a model-supplied id). */
export function brandMerchantAccount(brandSlug: string, accountId: string): MerchantAccount | null {
  return merchantAccountsFor(brandSlug).find((a) => a.id === accountId) ?? null;
}

export const OVERRIDE_SOURCE_NAME = "Second Brain title overrides (API)";

/**
 * The primary source's rule with our override source placed first, so its
 * title wins. Everything already in the rule is kept in order, including any
 * other supplemental source. An absent or empty rule means "the feed only",
 * which is spelled out as `{ self: true }`.
 *
 * Throws instead of returning a rule without `self`: Google then ignores the
 * feed's own attributes, which would strip price, link and availability from
 * every product in the account.
 */
export function ruleWithOverrideFirst(current: TakeFrom[] | undefined, overrideName: string): TakeFrom[] {
  const base = current && current.length > 0 ? current : [{ self: true }];
  const rest = base.filter((t) => t.supplementalDataSourceName !== overrideName);
  const next = [{ supplementalDataSourceName: overrideName }, ...rest];
  if (!next.some((t) => t.self)) {
    throw new Error("Refusing to save a feed rule without the feed itself (self).");
  }
  return next;
}

/** The rule with our override source removed: the exact pre-override rule when nothing else changed. */
export function ruleWithoutOverride(current: TakeFrom[] | undefined, overrideName: string): TakeFrom[] {
  const base = current && current.length > 0 ? current : [{ self: true }];
  const next = base.filter((t) => t.supplementalDataSourceName !== overrideName);
  if (!next.some((t) => t.self)) {
    throw new Error("Refusing to save a feed rule without the feed itself (self).");
  }
  return next;
}

export const MAX_TITLE_LENGTH = 150;
export const MAX_BATCH_SIZE = 200;
