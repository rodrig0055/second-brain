/**
 * Reading the cockpit's numbers out of what the sync stored.
 *
 * Everything here reads the database, never Meta. The daily sync is the only
 * thing that talks to the platform, so a page load costs nothing and cannot be
 * rate-limited into failing halfway down a table.
 *
 * The shape of the read follows where each level lives:
 *   account   metrics_daily, dimensionKey ""
 *   campaign  metrics_daily, dimensionKey = campaign id
 *   ad set    integration_records, recordType "adset_insight"
 *   ad        integration_records, recordType "ad_insight"
 *
 * Ad sets and ads are not in metrics_daily on purpose: the chat tools treat any
 * non-empty dimensionKey as a campaign, so rows there would be counted twice.
 */
import "server-only";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  adAnnotations,
  adCreatives,
  integrationRecords,
  metricsDaily,
} from "@/db/schema";
import { dateSpan } from "@/lib/date-range";
import type { InsightRow } from "@/lib/integrations/meta/client";
import { rowCounters, rowReach } from "@/lib/integrations/meta/counters";
import {
  resolveFunnel,
  type FunnelAnnotations,
  type Funnel,
} from "./funnel";
import {
  exactReach,
  sumCounters,
  withRates,
  type AdCounters,
  type AdTotals,
  type ReachFigure,
} from "./metrics";

export type AdsLevel = "campaign" | "adset" | "ad";

export type DateRange = { start: string; end: string };

/** One row of the pivot table. */
export type PivotRow = {
  level: AdsLevel;
  id: string;
  name: string;
  /** Which account this row came from, so several can share one table. */
  brandId: string;
  brandName: string;
  brandSlug: string;
  connectionId: string;
  adAccountId: string;
  /** Whether this account will accept a pause or an activate from here. */
  writeOk: boolean;
  /** Meta's campaign objective, from the creative cache. */
  objective: string;
  funnel: Funnel | null;
  funnelNeedsReview: boolean;
  funnelExplanation: string;
  audienceLabel: string;
  isEventAdSet: boolean;
  purpose: string;
  /** Meta's own status, from the most recent day that carried one. */
  status: string;
  campaignId: string;
  campaignName: string;
  adSetId: string;
  adSetName: string;
  totals: AdTotals;
  reach: ReachFigure;
  /** Days in the window on which this entity actually delivered. */
  daysActive: number;
  firstSeen: string;
  lastSeen: string;
  /** AI creative labels, with a human's override winning when present. */
  assetType?: string;
  messagingAngle?: string;
  hookTactic?: string;
  labelsOverridden: boolean;
  /**
   * What the classifier thinks the funnel is, when nobody has said.
   *
   * Never written into `ad_annotations` by anything but a person accepting it:
   * a guess and a decision have to stay distinguishable, or the funnel numbers
   * stop meaning what their column heading says.
   */
  aiFunnel?: { stage: Funnel; confidence: number };
  /** The same totals over the previous window, when comparing. */
  prevTotals?: AdTotals;
  trelloUrl: string;
  currency: string;
  /**
   * The creative itself, so a row can be looked at rather than only read.
   *
   * Comes from the synced `ad_creatives` cache, which means it costs nothing to
   * show. Meta's own rendering of the ad is fetched separately and on demand,
   * because those URLs expire.
   */
  creative?: {
    mediaType: string;
    imageUrl: string | null;
    thumbnailUrl: string | null;
    body: string;
    title: string;
    callToAction: string;
  };
};

/** Load a brand's annotations in the shape the funnel resolver expects. */
export async function loadFunnelAnnotations(
  connectionId: string,
): Promise<FunnelAnnotations & { byEntity: Map<string, typeof adAnnotations.$inferSelect> }> {
  const rows = await db
    .select()
    .from(adAnnotations)
    .where(eq(adAnnotations.connectionId, connectionId));

  const out: FunnelAnnotations = { ad: {}, adset: {}, campaign: {} };
  const byEntity = new Map<string, typeof adAnnotations.$inferSelect>();
  for (const row of rows) {
    byEntity.set(`${row.level}:${row.entityId}`, row);
    const level = row.level as keyof FunnelAnnotations;
    if (!out[level]) continue;
    // A row with no funnel set is still a row — it can carry a Trello link or
    // an override — but it must not claim a funnel it does not have.
    if (!row.funnel) continue;
    out[level]![row.entityId] = {
      funnel: row.funnel as Funnel,
      audienceLabel: row.audienceLabel || undefined,
      isEventAdSet: row.isEventAdSet,
    };
  }
  return { ...out, byEntity };
}

/** The stored insight rows for one level, already parsed. */
async function loadInsightRows(
  connectionId: string,
  recordType: "adset_insight" | "ad_insight",
  range: DateRange,
  filter?: { campaignId?: string; adSetId?: string; adId?: string },
): Promise<InsightRow[]> {
  const rows = await db
    .select({ data: integrationRecords.data })
    .from(integrationRecords)
    .where(
      and(
        eq(integrationRecords.connectionId, connectionId),
        eq(integrationRecords.recordType, recordType),
        gte(integrationRecords.periodStart, range.start),
        lte(integrationRecords.periodStart, range.end),
        // Drilling in narrows the query rather than the result: an account with
        // a hundred campaigns should not ship all of them to show one.
        filter?.campaignId
          ? sql`${integrationRecords.data}->>'campaign_id' = ${filter.campaignId}`
          : undefined,
        filter?.adSetId
          ? sql`${integrationRecords.data}->>'adset_id' = ${filter.adSetId}`
          : undefined,
        filter?.adId
          ? sql`${integrationRecords.data}->>'ad_id' = ${filter.adId}`
          : undefined,
      ),
    );
  return rows.map((r) => r.data as unknown as InsightRow);
}

/** Group parsed rows by an entity key, summing counters as it goes. */
function groupRows(
  rows: InsightRow[],
  keyOf: (row: InsightRow) => string | undefined,
) {
  const groups = new Map<
    string,
    { rows: InsightRow[]; counters: AdCounters[]; dates: string[] }
  >();
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = groups.get(key) ?? { rows: [], counters: [], dates: [] };
    group.rows.push(row);
    group.counters.push(rowCounters(row));
    group.dates.push(row.date_start);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Reach for a multi-day group.
 *
 * Exact only when the group is a single day. Summing reach across days
 * double-counts anyone seen on more than one, so a week's figure has to come
 * from Meta for that window and cannot be assembled here.
 */
function reachFor(
  rows: InsightRow[],
  impressions: number,
): ReachFigure {
  if (rows.length === 1) {
    return exactReach(rowReach(rows[0]), impressions);
  }
  const summed = rows.reduce((total, row) => total + rowReach(row), 0);
  return {
    reach: summed,
    frequency: summed > 0 ? impressions / summed : 0,
    exact: false,
  };
}

export type PivotOptions = {
  connectionId: string;
  brandId: string;
  level: AdsLevel;
  range: DateRange;
  currency: string;
  /**
   * Narrow to one campaign or ad set, for drilling down. Applied in SQL so a
   * drill-down does not transfer the whole account to filter it in memory.
   */
  filter?: { campaignId?: string; adSetId?: string };
  /** Compare against this window; fills `prevTotals`. */
  prev?: DateRange;
  /** Identity for a table that mixes several accounts. */
  brand?: { name: string; slug: string };
  adAccountId?: string;
  writeOk?: boolean;
};

/**
 * The active-ads pivot: one row per entity over the window.
 *
 * This is the replacement for the CSV export, the Niktin filter and the paste
 * into the sheet, so it carries the sheet's columns: funnel, audience, status,
 * days active, CIR, spend, purchases, value, frequency, CTR, LPVr, warm and
 * cost per warm, plus the AI labels and a Trello link.
 */
export async function loadPivot(options: PivotOptions): Promise<PivotRow[]> {
  const { connectionId, brandId, level, range, currency, filter, prev } = options;

  const annotations = await loadFunnelAnnotations(connectionId);

  if (level === "campaign") {
    return loadCampaignPivot(options, annotations);
  }

  const recordType = level === "adset" ? "adset_insight" : "ad_insight";
  const [rows, prevRows] = await Promise.all([
    loadInsightRows(connectionId, recordType, range, filter),
    prev ? loadInsightRows(connectionId, recordType, prev, filter) : Promise.resolve([]),
  ]);
  const keyOf = (row: InsightRow) => (level === "adset" ? row.adset_id : row.ad_id);
  const groups = groupRows(rows, keyOf);
  const prevGroups = groupRows(prevRows, keyOf);

  // Creative rows carry the AI labels, the status and the objective. At ad set
  // level they are read for the ads inside, so an ad set can show what the
  // classifier thought without a second call to Meta.
  const creatives = groups.size
    ? await db
        .select()
        .from(adCreatives)
        .where(
          and(
            eq(adCreatives.connectionId, connectionId),
            level === "adset"
              ? inArray(adCreatives.adsetId, [...groups.keys()])
              : inArray(adCreatives.adId, [...groups.keys()]),
          ),
        )
    : [];
  const creativeById = new Map(creatives.map((c) => [c.adId, c]));

  // One vote per ad set, from the ads in it. A majority is a suggestion, not a
  // fact, and it is labelled as one wherever it is shown.
  const adsetVotes = new Map<string, { stage: Funnel; confidence: number }>();
  if (level === "adset") {
    const byAdset = new Map<string, { stage: string; confidence: number }[]>();
    for (const c of creatives) {
      if (!c.adsetId || !c.funnelStage) continue;
      const list = byAdset.get(c.adsetId) ?? [];
      list.push({ stage: c.funnelStage, confidence: Number(c.confidence ?? 0) });
      byAdset.set(c.adsetId, list);
    }
    for (const [adsetId, votes] of byAdset) {
      const tally = new Map<string, number>();
      for (const v of votes) tally.set(v.stage, (tally.get(v.stage) ?? 0) + 1);
      const [stage, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
      adsetVotes.set(adsetId, { stage: stage as Funnel, confidence: n / votes.length });
    }
  }

  const out: PivotRow[] = [];
  for (const [id, group] of groups) {
    const last = group.rows[group.rows.length - 1];
    const totals = withRates(sumCounters(group.counters));
    const resolved = resolveFunnel(
      {
        adId: level === "ad" ? id : undefined,
        adSetId: level === "adset" ? id : last.adset_id,
        adSetName: last.adset_name,
        campaignId: last.campaign_id,
        campaignName: last.campaign_name,
      },
      annotations,
    );
    const annotation =
      annotations.byEntity.get(`${level}:${id}`) ??
      (last.adset_id
        ? annotations.byEntity.get(`adset:${last.adset_id}`)
        : undefined);
    const creative = level === "ad" ? creativeById.get(id) : undefined;
    const dates = group.dates.sort();
    const prevGroup = prevGroups.get(id);

    const aiStage =
      level === "adset"
        ? adsetVotes.get(id)
        : creative?.funnelStage
          ? {
              stage: creative.funnelStage as Funnel,
              confidence: Number(creative.confidence ?? 0),
            }
          : undefined;

    out.push({
      level,
      id,
      brandId,
      brandName: options.brand?.name ?? "",
      brandSlug: options.brand?.slug ?? "",
      connectionId,
      adAccountId: options.adAccountId ?? "",
      writeOk: options.writeOk ?? false,
      objective: creative?.objective ?? "",
      name:
        (level === "adset" ? last.adset_name : last.ad_name) ??
        annotation?.entityName ??
        id,
      funnel: resolved.funnel,
      funnelNeedsReview: resolved.needsReview,
      funnelExplanation: resolved.explanation,
      audienceLabel: resolved.audienceLabel ?? "",
      isEventAdSet: resolved.isEventAdSet,
      purpose: annotation?.purpose ?? "",
      status: creative?.effectiveStatus ?? "",
      campaignId: last.campaign_id ?? "",
      campaignName: last.campaign_name ?? "",
      adSetId: last.adset_id ?? "",
      adSetName: last.adset_name ?? "",
      totals,
      reach: reachFor(group.rows, totals.impressions),
      // Days with no impressions are days Meta did not deliver it, which is
      // what the sheet's "Days Active" counts.
      daysActive: group.counters.filter((c) => c.impressions > 0).length,
      firstSeen: dates[0] ?? "",
      lastSeen: dates[dates.length - 1] ?? "",
      assetType: annotation?.angleOverride ? undefined : creative?.aiAssetType ?? undefined,
      messagingAngle:
        annotation?.angleOverride ?? creative?.messagingAngle ?? undefined,
      hookTactic: annotation?.hookOverride ?? creative?.hookTactic ?? undefined,
      labelsOverridden: Boolean(annotation?.angleOverride || annotation?.hookOverride),
      // Only offered where a person has not already decided.
      aiFunnel: resolved.funnel ? undefined : aiStage,
      prevTotals: prevGroup ? withRates(sumCounters(prevGroup.counters)) : undefined,
      trelloUrl: annotation?.trelloUrl ?? "",
      currency,
      creative: creative
        ? {
            mediaType: creative.mediaType,
            imageUrl: creative.imageUrl,
            thumbnailUrl: creative.thumbnailUrl,
            body: creative.body,
            title: creative.title,
            callToAction: creative.callToAction,
          }
        : undefined,
    });
  }

  // Biggest spender first: that is what the sheet is sorted by and what the
  // specialist scans down.
  return out.sort((a, b) => b.totals.spend - a.totals.spend);
}

/** Campaigns come from metrics_daily, where the sync already keys them. */
async function loadCampaignPivot(
  options: PivotOptions,
  annotations: Awaited<ReturnType<typeof loadFunnelAnnotations>>,
): Promise<PivotRow[]> {
  const { brandId, range, currency } = options;
  const rows = await db
    .select()
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.brandId, brandId),
        eq(metricsDaily.platform, "meta"),
        gte(metricsDaily.date, range.start),
        lte(metricsDaily.date, range.end),
      ),
    );

  const groups = new Map<
    string,
    { name: string; counters: AdCounters[]; reach: number; dates: string[] }
  >();
  for (const row of rows) {
    if (!row.dimensionKey) continue; // "" is the account total
    const dimension = (row.dimension ?? {}) as { campaignName?: string };
    const extra = (row.extra ?? {}) as Record<string, number>;
    const group = groups.get(row.dimensionKey) ?? {
      name: dimension.campaignName ?? row.dimensionKey,
      counters: [],
      reach: 0,
      dates: [],
    };
    group.counters.push({
      spend: Number(row.spend),
      impressions: row.impressions,
      clicksAll: extra.clicksAll ?? row.clicks,
      linkClicks: extra.linkClicks ?? row.clicks,
      outboundClicks: extra.outboundClicks ?? 0,
      landingPageViews: extra.landingPageViews ?? 0,
      purchases: row.conversions,
      purchaseValue: Number(row.revenue),
      addToCart: extra.addToCart ?? 0,
      initiateCheckout: extra.initiateCheckout ?? 0,
      videoViews3s: extra.videoViews3s ?? 0,
      thruPlays: extra.thruPlays ?? 0,
    });
    group.reach += extra.reach ?? 0;
    group.dates.push(row.date);
    groups.set(row.dimensionKey, group);
  }

  const out: PivotRow[] = [];
  for (const [id, group] of groups) {
    const totals = withRates(sumCounters(group.counters));
    const resolved = resolveFunnel(
      { campaignId: id, campaignName: group.name },
      annotations,
    );
    const dates = group.dates.sort();
    const single = group.dates.length === 1;
    out.push({
      level: "campaign",
      id,
      name: group.name,
      brandId,
      brandName: options.brand?.name ?? "",
      brandSlug: options.brand?.slug ?? "",
      connectionId: options.connectionId,
      adAccountId: options.adAccountId ?? "",
      writeOk: options.writeOk ?? false,
      // Campaign rows come from metrics_daily, which carries no objective.
      objective: "",
      funnel: resolved.funnel,
      funnelNeedsReview: resolved.needsReview,
      funnelExplanation: resolved.explanation,
      audienceLabel: resolved.audienceLabel ?? "",
      isEventAdSet: resolved.isEventAdSet,
      purpose: annotations.byEntity.get(`campaign:${id}`)?.purpose ?? "",
      status: "",
      campaignId: id,
      campaignName: group.name,
      adSetId: "",
      adSetName: "",
      totals,
      reach: single
        ? exactReach(group.reach, totals.impressions)
        : {
            reach: group.reach,
            frequency: group.reach > 0 ? totals.impressions / group.reach : 0,
            exact: false,
          },
      daysActive: group.counters.filter((c) => c.impressions > 0).length,
      firstSeen: dates[0] ?? "",
      lastSeen: dates[dates.length - 1] ?? "",
      labelsOverridden: false,
      trelloUrl: annotations.byEntity.get(`campaign:${id}`)?.trelloUrl ?? "",
      currency,
    });
  }
  return out.sort((a, b) => b.totals.spend - a.totals.spend);
}

export type EntityDay = { date: string; totals: AdTotals };

/**
 * One entity's numbers day by day, for the drawer's trend chart.
 *
 * Every day of the window is present, zero-filled where the entity did not
 * deliver: a line that skips a dark day draws a straight bridge across it and
 * hides exactly the pause someone opened the chart to find.
 */
export async function loadEntityDaily(options: {
  connectionId: string;
  brandId: string;
  level: AdsLevel;
  entityId: string;
  range: DateRange;
}): Promise<EntityDay[]> {
  const { connectionId, brandId, level, entityId, range } = options;
  const byDate = new Map<string, AdCounters[]>();
  const put = (date: string, counters: AdCounters) =>
    byDate.set(date, [...(byDate.get(date) ?? []), counters]);

  if (level === "campaign") {
    const rows = await db
      .select()
      .from(metricsDaily)
      .where(
        and(
          eq(metricsDaily.brandId, brandId),
          eq(metricsDaily.platform, "meta"),
          eq(metricsDaily.dimensionKey, entityId),
          gte(metricsDaily.date, range.start),
          lte(metricsDaily.date, range.end),
        ),
      );
    for (const row of rows) {
      const extra = (row.extra ?? {}) as Record<string, number>;
      put(row.date, {
        spend: Number(row.spend),
        impressions: row.impressions,
        clicksAll: extra.clicksAll ?? row.clicks,
        linkClicks: extra.linkClicks ?? row.clicks,
        outboundClicks: extra.outboundClicks ?? 0,
        landingPageViews: extra.landingPageViews ?? 0,
        purchases: row.conversions,
        purchaseValue: Number(row.revenue),
        addToCart: extra.addToCart ?? 0,
        initiateCheckout: extra.initiateCheckout ?? 0,
        videoViews3s: extra.videoViews3s ?? 0,
        thruPlays: extra.thruPlays ?? 0,
      });
    }
  } else {
    const rows = await loadInsightRows(
      connectionId,
      level === "adset" ? "adset_insight" : "ad_insight",
      range,
      level === "adset" ? { adSetId: entityId } : { adId: entityId },
    );
    for (const row of rows) put(row.date_start, rowCounters(row));
  }

  return dateSpan(range.start, range.end).map((date) => ({
    date,
    totals: withRates(sumCounters(byDate.get(date) ?? [])),
  }));
}

export type TrackerRow = {
  date: string;
  /** TOF | MOF | BOF | UNMAPPED | TOTAL */
  funnel: string;
  totals: AdTotals;
  reach: ReachFigure;
};

/**
 * The daily tracker: one row per funnel per day, plus the account total.
 *
 * TOTAL comes from the account-level rows rather than by adding the funnels up,
 * so the two are independent. An UNMAPPED row carries the difference, which is
 * the only way an ad set nobody has classified shows itself — otherwise it just
 * quietly shrinks whichever funnel total someone happens to be reading.
 */
export async function loadDailyTracker(options: {
  connectionId: string;
  brandId: string;
  range: DateRange;
}): Promise<TrackerRow[]> {
  const { connectionId, brandId, range } = options;
  const annotations = await loadFunnelAnnotations(connectionId);

  const adSetRows = await loadInsightRows(connectionId, "adset_insight", range);
  const accountRows = await db
    .select()
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.brandId, brandId),
        eq(metricsDaily.platform, "meta"),
        eq(metricsDaily.dimensionKey, ""),
        gte(metricsDaily.date, range.start),
        lte(metricsDaily.date, range.end),
      ),
    );

  const byDate = new Map<string, Map<string, { counters: AdCounters[]; reach: number }>>();
  const put = (date: string, funnel: string, counters: AdCounters, reach: number) => {
    const day = byDate.get(date) ?? new Map();
    const cell = day.get(funnel) ?? { counters: [], reach: 0 };
    cell.counters.push(counters);
    cell.reach += reach;
    day.set(funnel, cell);
    byDate.set(date, day);
  };

  for (const row of adSetRows) {
    const resolved = resolveFunnel(
      {
        adSetId: row.adset_id,
        adSetName: row.adset_name,
        campaignId: row.campaign_id,
        campaignName: row.campaign_name,
      },
      annotations,
    );
    put(row.date_start, resolved.funnel ?? "UNMAPPED", rowCounters(row), rowReach(row));
  }

  const out: TrackerRow[] = [];
  const order = ["TOF", "MOF", "BOF", "UNMAPPED", "TOTAL"];

  for (const account of accountRows) {
    const extra = (account.extra ?? {}) as Record<string, number>;
    const day = byDate.get(account.date) ?? new Map();

    for (const funnel of ["TOF", "MOF", "BOF", "UNMAPPED"]) {
      const cell = day.get(funnel);
      if (!cell) continue;
      const totals = withRates(sumCounters(cell.counters));
      out.push({
        date: account.date,
        funnel,
        totals,
        // One day of one funnel is still several ad sets, and reach does not
        // add across them either.
        reach: {
          reach: cell.reach,
          frequency: cell.reach > 0 ? totals.impressions / cell.reach : 0,
          exact: cell.counters.length === 1,
        },
      });
    }

    const totals = withRates({
      spend: Number(account.spend),
      impressions: account.impressions,
      clicksAll: extra.clicksAll ?? account.clicks,
      linkClicks: extra.linkClicks ?? account.clicks,
      outboundClicks: extra.outboundClicks ?? 0,
      landingPageViews: extra.landingPageViews ?? 0,
      purchases: account.conversions,
      purchaseValue: Number(account.revenue),
      addToCart: extra.addToCart ?? 0,
      initiateCheckout: extra.initiateCheckout ?? 0,
      videoViews3s: extra.videoViews3s ?? 0,
      thruPlays: extra.thruPlays ?? 0,
    });
    out.push({
      date: account.date,
      funnel: "TOTAL",
      totals,
      // The account's own reach for that day, which Meta deduplicated.
      reach: exactReach(extra.reach ?? 0, totals.impressions),
    });
  }

  return out.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      order.indexOf(a.funnel) - order.indexOf(b.funnel),
  );
}
