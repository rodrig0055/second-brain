/**
 * Running the kill rules over an account and recording what they found.
 *
 * The split from evaluate.ts is deliberate: that file is pure judgement and has
 * tests; this one reads the database, decides the windows and writes alerts.
 *
 * Two windows are built for every entity, because the rules need both. The
 * settled window ends before Meta's restatement period, so a purchase can no
 * longer be added to it; the live window runs to yesterday. Anything judging
 * purchases reads settled. Only spend-based rules, which the doc wants early,
 * read live, and they mark their findings provisional.
 */
import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { adAlerts, adCreatives, adRules } from "@/db/schema";
import type { DbConnection } from "@/lib/integrations/types";
import { withRates, sumCounters, type AdCounters } from "../metrics";
import { resolveFunnel, type Funnel } from "../funnel";
import { loadFunnelAnnotations } from "../store";
import { evaluateSubject } from "./evaluate";
import type { Rule, RuleContext, RuleFinding, RuleSubject } from "./types";
import { rowCounters, rowReach } from "@/lib/integrations/meta/counters";
import type { InsightRow } from "@/lib/integrations/meta/client";
import { integrationRecords, metricsDaily } from "@/db/schema";

/** Meta keeps crediting purchases back this far; matches the sync's window. */
const RESTATE_DAYS = 8;

/** How much history a rule may look at. */
const LOOKBACK_DAYS = 30;

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  return ymd(new Date(Date.now() - n * 86_400_000));
}

/** Load the brand's configured rules, in the evaluator's shape. */
export async function loadRules(connectionId: string): Promise<Rule[]> {
  const rows = await db
    .select()
    .from(adRules)
    .where(eq(adRules.connectionId, connectionId));

  return rows.map((row) => ({
    key: row.key,
    kind: row.kind as Rule["kind"],
    enabled: row.enabled,
    currency: row.currency,
    level: row.level as Rule["level"],
    funnels: (row.funnels ?? []) as Funnel[],
    includeEventAdSets: row.includeEventAdSets,
    params: (row.params ?? {}) as Record<string, number>,
    confirmed: row.confirmedAt !== null,
  }));
}

type Grouped = {
  rows: InsightRow[];
  settled: AdCounters[];
  live: AdCounters[];
  reach: number;
  reachRows: number;
  days: Set<string>;
};

/**
 * Build one subject per entity at a level, with both windows summed.
 *
 * Ad set and ad rows both come from integration_records, so this reads them
 * once and splits each day into the right bucket rather than querying twice.
 */
async function subjectsFor(
  conn: DbConnection,
  level: "ad" | "adset",
  currency: string,
): Promise<RuleSubject[]> {
  const settledEnd = daysAgo(RESTATE_DAYS);
  const liveEnd = daysAgo(1);
  const start = daysAgo(LOOKBACK_DAYS);

  const records = await db
    .select({
      data: integrationRecords.data,
      periodStart: integrationRecords.periodStart,
    })
    .from(integrationRecords)
    .where(
      and(
        eq(integrationRecords.connectionId, conn.id),
        eq(
          integrationRecords.recordType,
          level === "adset" ? "adset_insight" : "ad_insight",
        ),
        sql`${integrationRecords.periodStart} >= ${start}`,
        sql`${integrationRecords.periodStart} <= ${liveEnd}`,
      ),
    );

  const annotations = await loadFunnelAnnotations(conn.id);
  const groups = new Map<string, Grouped>();

  for (const record of records) {
    const row = record.data as unknown as InsightRow;
    const id = level === "adset" ? row.adset_id : row.ad_id;
    if (!id) continue;
    const group = groups.get(id) ?? {
      rows: [],
      settled: [],
      live: [],
      reach: 0,
      reachRows: 0,
      days: new Set<string>(),
    };
    const counters = rowCounters(row);
    group.rows.push(row);
    group.live.push(counters);
    if ((record.periodStart ?? "") <= settledEnd) group.settled.push(counters);
    group.reach += rowReach(row);
    group.reachRows += 1;
    if (counters.impressions > 0) group.days.add(row.date_start);
    groups.set(id, group);
  }

  // Status and creation time live on ad_creatives, which the classifier fills.
  // Without it an ad's status is unknown, and the failed-to-run rule needs both,
  // so it simply will not fire rather than guessing the ad is live.
  const creatives = groups.size
    ? await db
        .select()
        .from(adCreatives)
        .where(
          and(
            eq(adCreatives.connectionId, conn.id),
            inArray(adCreatives.adId, [...groups.keys()]),
          ),
        )
    : [];
  const creativeById = new Map(creatives.map((c) => [c.adId, c]));

  const subjects: RuleSubject[] = [];
  for (const [id, group] of groups) {
    const last = group.rows[group.rows.length - 1];
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
    const creative = creativeById.get(id);
    const live = withRates(sumCounters(group.live));

    subjects.push({
      level,
      id,
      name:
        (level === "adset" ? last.adset_name : last.ad_name) ?? id,
      funnel: resolved.funnel,
      isEventAdSet: resolved.isEventAdSet,
      status: creative?.effectiveStatus ?? "",
      currency,
      daysActive: group.days.size,
      createdAt: creative?.createdAt ?? undefined,
      settled: withRates(sumCounters(group.settled)),
      live,
      frequency: {
        value: group.reach > 0 ? live.impressions / group.reach : 0,
        // Only one row means one entity on one day, which is the only case
        // where Meta's reach is a real number for this window.
        exact: group.reachRows === 1,
      },
    });
  }
  return subjects;
}

/**
 * The account's cost per purchase over the trailing settled week.
 *
 * The baseline for the doc's "3X KPI" rule. Null when the account had no
 * purchases in that week, which makes the rule skip rather than compare
 * everything against zero.
 */
export async function weeklyCpa(
  conn: DbConnection,
): Promise<number | null> {
  const end = daysAgo(RESTATE_DAYS);
  const start = daysAgo(RESTATE_DAYS + 7);
  const rows = await db
    .select()
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.brandId, conn.brandId),
        eq(metricsDaily.platform, "meta"),
        eq(metricsDaily.dimensionKey, ""),
        sql`${metricsDaily.date} >= ${start}`,
        sql`${metricsDaily.date} <= ${end}`,
      ),
    );
  const spend = rows.reduce((total, r) => total + Number(r.spend), 0);
  const purchases = rows.reduce((total, r) => total + r.conversions, 0);
  return purchases > 0 ? spend / purchases : null;
}

/**
 * The stable identity of a finding.
 *
 * Rule, entity and the end of the window it judged. A rule that keeps finding
 * the same thing updates one row instead of filing a new alert every run: a
 * daily pass without this would show the same fifteen alerts every morning,
 * which is how people learn to ignore all of them.
 */
function fingerprintOf(finding: RuleFinding, windowEnd: string): string {
  return `${finding.ruleKey}:${finding.subject.level}:${finding.subject.id}:${windowEnd}`;
}

export type RunRulesResult = {
  evaluated: number;
  findings: number;
  opened: number;
  updated: number;
  resolved: number;
  skipped?: string;
};

/**
 * Evaluate an account and reconcile the alert table with what was found.
 *
 * Alerts that no longer reproduce are resolved, not deleted: an ad that fixed
 * itself, or that someone paused, is part of the record. Acknowledged alerts
 * stay acknowledged when they recur within the same window, so silencing one
 * is not undone by the next run.
 */
export async function runRules(
  conn: DbConnection,
  currency: string,
): Promise<RunRulesResult> {
  const rules = await loadRules(conn.id);
  if (rules.length === 0) {
    return {
      evaluated: 0,
      findings: 0,
      opened: 0,
      updated: 0,
      resolved: 0,
      skipped: "No rules configured for this account.",
    };
  }

  const ctx: RuleContext = {
    weeklyCpa: await weeklyCpa(conn),
    currency,
    now: new Date(),
  };

  const wanted = new Set(rules.map((r) => r.level));
  const subjects = [
    ...(wanted.has("ad") ? await subjectsFor(conn, "ad", currency) : []),
    ...(wanted.has("adset") ? await subjectsFor(conn, "adset", currency) : []),
  ];

  const windowEnd = daysAgo(1);
  const windowStart = daysAgo(LOOKBACK_DAYS);
  const findings = subjects.flatMap((subject) =>
    evaluateSubject(rules, subject, ctx),
  );

  const ruleIdByKey = new Map(
    (await db.select().from(adRules).where(eq(adRules.connectionId, conn.id))).map(
      (r) => [r.key, r.id],
    ),
  );

  let opened = 0;
  let updated = 0;
  const seen = new Set<string>();

  for (const finding of findings) {
    const fingerprint = fingerprintOf(finding, windowEnd);
    seen.add(fingerprint);
    const existing = await db.query.adAlerts.findFirst({
      where: and(
        eq(adAlerts.connectionId, conn.id),
        eq(adAlerts.fingerprint, fingerprint),
      ),
    });

    if (existing) {
      await db
        .update(adAlerts)
        .set({
          lastSeenAt: new Date(),
          observed: String(
            Number.isFinite(finding.observed) ? finding.observed : 0,
          ),
          message: finding.message,
          severity: finding.severity,
          provisional: finding.provisional,
          // An acknowledged alert stays acknowledged. Re-opening it would
          // undo a person's decision to live with it for now.
          state: existing.state === "resolved" ? "open" : existing.state,
        })
        .where(eq(adAlerts.id, existing.id));
      updated++;
      continue;
    }

    await db.insert(adAlerts).values({
      connectionId: conn.id,
      brandId: conn.brandId,
      ruleId: ruleIdByKey.get(finding.ruleKey) ?? null,
      ruleKey: finding.ruleKey,
      kind: finding.kind,
      severity: finding.severity,
      level: finding.subject.level,
      entityId: finding.subject.id,
      entityName: finding.subject.name,
      funnel: finding.subject.funnel,
      fingerprint,
      metric: finding.metric,
      observed: String(Number.isFinite(finding.observed) ? finding.observed : 0),
      threshold: String(finding.threshold),
      message: finding.message,
      provisional: finding.provisional,
      confirmed: finding.confirmed,
      windowStart,
      windowEnd,
    });
    opened++;
  }

  // Anything open for this window that no longer reproduces has been fixed,
  // paused, or has simply moved back inside its threshold.
  const openNow = await db
    .select()
    .from(adAlerts)
    .where(
      and(
        eq(adAlerts.connectionId, conn.id),
        eq(adAlerts.windowEnd, windowEnd),
        inArray(adAlerts.state, ["open", "acknowledged"]),
      ),
    );
  let resolved = 0;
  for (const alert of openNow) {
    if (seen.has(alert.fingerprint)) continue;
    await db
      .update(adAlerts)
      .set({ state: "resolved" })
      .where(eq(adAlerts.id, alert.id));
    resolved++;
  }

  return {
    evaluated: subjects.length,
    findings: findings.length,
    opened,
    updated,
    resolved,
  };
}
