/**
 * Reading the account's configuration, as opposed to its performance.
 *
 * Everything else in this folder goes to `/insights`, which answers "how did
 * this do". These go to `/campaigns`, `/adsets` and `/ads`, which answer "how
 * is this set up": objective, budget, bid, schedule, targeting. Two different
 * questions, two different endpoints, and the app has only ever asked the
 * first.
 *
 * The field lists are explicit and commented rather than `fields=*`, which
 * Meta does not support anyway. They are also the first draft of the
 * allowlists the write layer will need: a field nobody has thought about is a
 * field nobody should be able to change.
 */
import { createHash } from "node:crypto";

import { graphGet, type MetaTarget } from "./client";

export type EntityLevel = "campaign" | "adset" | "ad";

/**
 * Currencies whose amounts Meta reports in whole units.
 *
 * Budgets come back in the account currency's minor unit, so USD 12.50 is
 * "1250". For a currency with no minor unit the same field is already whole:
 * VND 50000 is "50000", not "500". Dividing everything by 100 would quietly
 * report Bloomly VN's budgets as a hundredth of themselves.
 *
 * ISO 4217 exponent 0, limited to the currencies this business could plausibly
 * bill in. Anything unlisted is assumed to have two decimal places, which is
 * true of every currency the accounts use today.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "VND",
  "JPY",
  "KRW",
  "CLP",
  "ISK",
  "XAF",
  "XOF",
  "XPF",
  "BIF",
  "DJF",
  "GNF",
  "KMF",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VUV",
]);

/** Turn Meta's minor-unit string into an amount a person would recognise. */
export function fromMinorUnits(
  minor: string | number | null | undefined,
  currency: string,
): number | null {
  if (minor === null || minor === undefined || minor === "") return null;
  const value = Number(minor);
  if (!Number.isFinite(value)) return null;
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())
    ? value
    : value / 100;
}

/**
 * A stable fingerprint of a targeting spec.
 *
 * Keys are sorted at every level before hashing, because Meta does not promise
 * key order and an unchanged spec that serializes two ways would otherwise read
 * as an edit every sync.
 */
export function targetingFingerprint(
  targeting: Record<string, unknown> | null | undefined,
): string {
  if (!targeting) return "";
  return createHash("sha256").update(canonical(targeting)).digest("hex").slice(0, 32);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

/** Meta timestamps are ISO with an offset; an empty one is not epoch zero. */
function asDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minor(value: string | number | undefined | null): string | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? String(Math.round(n)) : null;
}

// v26.0 Campaign read fields. Budget lives here under campaign budget
// optimisation and on the ad set otherwise, so both levels ask for it.
const CAMPAIGN_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "objective",
  "buying_type",
  "bid_strategy",
  "daily_budget",
  "lifetime_budget",
  "budget_remaining",
  "start_time",
  "stop_time",
  "created_time",
  "updated_time",
].join(",");

// v26.0 AdSet read fields. Note `end_time`, not `stop_time`: the two levels
// spell the same idea differently and reading the wrong one returns nothing.
const ADSET_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "campaign_id",
  "bid_strategy",
  "bid_amount",
  "billing_event",
  "optimization_goal",
  "daily_budget",
  "lifetime_budget",
  "budget_remaining",
  "promoted_object",
  "targeting",
  "start_time",
  "end_time",
  "created_time",
  "updated_time",
].join(",");

const AD_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "adset_id",
  "campaign_id",
  "created_time",
  "updated_time",
].join(",");

/** One entity, flattened into the columns `ad_entities` holds. */
export type NormalizedEntity = {
  level: EntityLevel;
  entityId: string;
  name: string;
  status: string;
  effectiveStatus: string;
  campaignId: string;
  adSetId: string;
  objective: string;
  buyingType: string;
  bidStrategy: string;
  billingEvent: string;
  optimizationGoal: string;
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  budgetRemainingMinor: string | null;
  bidAmountMinor: string | null;
  targeting: Record<string, unknown> | null;
  targetingHash: string;
  promotedObject: Record<string, unknown> | null;
  startTime: Date | null;
  stopTime: Date | null;
  metaCreatedAt: Date | null;
  metaUpdatedAt: Date | null;
};

type RawEntity = {
  id?: string;
  name?: string;
  status?: string;
  effective_status?: string;
  campaign_id?: string;
  adset_id?: string;
  objective?: string;
  buying_type?: string;
  bid_strategy?: string;
  bid_amount?: string | number;
  billing_event?: string;
  optimization_goal?: string;
  daily_budget?: string | number;
  lifetime_budget?: string | number;
  budget_remaining?: string | number;
  promoted_object?: Record<string, unknown>;
  targeting?: Record<string, unknown>;
  start_time?: string;
  stop_time?: string;
  end_time?: string;
  created_time?: string;
  updated_time?: string;
};

export function normalizeEntity(
  raw: RawEntity,
  level: EntityLevel,
): NormalizedEntity | null {
  if (!raw.id) return null;
  const targeting = raw.targeting ?? null;
  return {
    level,
    entityId: raw.id,
    name: raw.name ?? "",
    status: raw.status ?? "",
    effectiveStatus: raw.effective_status ?? "",
    campaignId: raw.campaign_id ?? (level === "campaign" ? raw.id : ""),
    adSetId: raw.adset_id ?? (level === "adset" ? raw.id : ""),
    objective: raw.objective ?? "",
    buyingType: raw.buying_type ?? "",
    bidStrategy: raw.bid_strategy ?? "",
    billingEvent: raw.billing_event ?? "",
    optimizationGoal: raw.optimization_goal ?? "",
    dailyBudgetMinor: minor(raw.daily_budget),
    lifetimeBudgetMinor: minor(raw.lifetime_budget),
    budgetRemainingMinor: minor(raw.budget_remaining),
    bidAmountMinor: minor(raw.bid_amount),
    targeting,
    targetingHash: targetingFingerprint(targeting),
    promotedObject: raw.promoted_object ?? null,
    startTime: asDate(raw.start_time),
    // Campaigns stop, ad sets end. Same field, two names.
    stopTime: asDate(raw.stop_time ?? raw.end_time),
    metaCreatedAt: asDate(raw.created_time),
    metaUpdatedAt: asDate(raw.updated_time),
  };
}

/**
 * Configuration lives on campaigns and ad sets. Ads are not mirrored.
 *
 * Measured, after a first run that took eleven minutes. The three accounts
 * returned 455 campaigns, 2,061 ad sets and 11,710 ads, and of those 11,710 ad
 * rows: zero carried a budget, zero carried targeting, zero carried an
 * optimisation goal, zero a bid strategy, zero a schedule. Every one of those
 * is a campaign or ad-set field. The ad level was 83% of the work for nothing
 * the mirror exists to answer.
 *
 * An ad's name, status and parents, which is all it did carry, are already in
 * `metrics_daily` and already on the row the drawer opens from.
 *
 * Filtering ads by status was tried first and dropped nothing: 10,372 of the
 * 11,710 are PAUSED rather than archived, because this team pauses ads and
 * leaves them. There was no subset worth keeping.
 */
const EDGE: Record<EntityLevel, { path: string; fields: string }> = {
  campaign: { path: "campaigns", fields: CAMPAIGN_FIELDS },
  adset: { path: "adsets", fields: ADSET_FIELDS },
  ad: { path: "ads", fields: AD_FIELDS },
};

/** Pages of 200, capped. Exported so the truncation check cannot drift from it. */
export const PAGE_SIZE = 200;
export const MAX_PAGES = 50;

/** The shape of `graphGet`, so a test can stand in for the network. */
export type EdgeReader = (
  target: MetaTarget,
  path: string,
  params: Record<string, string | number | undefined>,
  maxPages?: number,
) => Promise<RawEntity[]>;

/**
 * Every entity of one level on an account.
 *
 * Archived and deleted entities are included deliberately. An ad set that was
 * deleted last week still explains a row in `metrics_daily`, and leaving it out
 * would make the config lookup fail for exactly the history someone is trying
 * to understand.
 *
 * `read` exists so the field lists and the normalisation can be proven without
 * a Meta token, which is not available on every machine this is developed on.
 */
export async function fetchEntities(
  target: MetaTarget,
  level: EntityLevel,
  read: EdgeReader = graphGet,
): Promise<{ entities: NormalizedEntity[]; truncated: boolean }> {
  const edge = EDGE[level];
  const rows = await read(
    target,
    `${target.accountId}/${edge.path}`,
    { fields: edge.fields, limit: PAGE_SIZE },
    MAX_PAGES,
  );

  // Exactly the ceiling means the walk stopped because it ran out of pages,
  // not because the account ran out of entities. A mirror that is quietly
  // missing rows is worse than one that is missing and says so: every
  // freshness and staleness check downstream would read as confident.
  const truncated = rows.length >= PAGE_SIZE * MAX_PAGES;

  return {
    entities: rows
      .map((row) => normalizeEntity(row, level))
      .filter((row): row is NormalizedEntity => row !== null),
    truncated,
  };
}

/** The exact fields each level asks Meta for. Exported so tests can assert them. */
export const FIELDS_BY_LEVEL: Record<EntityLevel, string> = {
  campaign: CAMPAIGN_FIELDS,
  adset: ADSET_FIELDS,
  ad: AD_FIELDS,
};
