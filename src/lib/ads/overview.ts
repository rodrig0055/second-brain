import "server-only";

import { and, count, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adActions, adAlerts, adRules } from "@/db/schema";
import { loadDailyTracker, loadPivot } from "@/lib/ads/store";
import { latestDigest, recentDigests, type Digest, type DigestStats } from "@/lib/ads/digest";
import { sumCounters, withRates, type AdTotals } from "@/lib/ads/metrics";
import { FUNNELS, type Funnel } from "@/lib/ads/funnel";
import type { MetaScopeBrand } from "@/lib/ads/scope";
import type { DateWindow } from "@/lib/date-range";

/**
 * The portfolio view: every account a specialist runs, side by side.
 *
 * Money is never added across accounts. Each card carries its own currency
 * because there is no FX in this app, and a blended total across a PHP and a
 * USD account would be a number that cannot be acted on.
 */

export type FunnelSlice = {
  funnel: Funnel | "UNMAPPED";
  totals: AdTotals;
  targetCirPct: number | null;
  targetConfirmed: boolean;
  overTarget: boolean;
};

export type BrandOverview = {
  brandId: string;
  brandName: string;
  brandSlug: string;
  connectionId: string;
  currency: string;
  adAccountId: string;
  writeGate: { ok: boolean; reason: string };
  totals: AdTotals;
  prevTotals: AdTotals | null;
  funnels: FunnelSlice[];
  unmappedSpend: number;
  alerts: { open: number; critical: number; warning: number; acknowledged: number };
  actions: { pending: number; failed: number };
  digest: { date: string; report: Digest; stats: DigestStats } | null;
  digestHistory: { date: string; stats: DigestStats }[];
  lastSyncAt: Date | null;
};

/** CIR targets a person has set for this account, by funnel. */
async function cirTargets(
  connectionId: string,
): Promise<Map<string, { pct: number; confirmed: boolean }>> {
  const rules = await db
    .select()
    .from(adRules)
    .where(and(eq(adRules.connectionId, connectionId), eq(adRules.kind, "cir_over_target")));

  const out = new Map<string, { pct: number; confirmed: boolean }>();
  for (const rule of rules) {
    const params = (rule.params ?? {}) as { targetPct?: number };
    const funnels = (rule.funnels ?? []) as string[];
    if (params.targetPct === undefined) continue;
    for (const funnel of funnels.length ? funnels : FUNNELS) {
      out.set(funnel, { pct: params.targetPct, confirmed: Boolean(rule.confirmedAt) });
    }
  }
  return out;
}

export async function loadOverview(
  scope: MetaScopeBrand[],
  range: DateWindow,
  prev?: DateWindow,
): Promise<BrandOverview[]> {
  return Promise.all(
    scope.map(async (account) => {
      const { brand, connection, currency } = account;
      const base = {
        connectionId: connection.id,
        brandId: brand.id,
        currency,
        brand: { name: brand.name, slug: brand.slug },
        adAccountId: account.adAccountId,
        writeOk: account.writeGate.ok,
      };

      const [campaigns, prevCampaigns, tracker, targets, alertRows, actionRows, digest, history] =
        await Promise.all([
          loadPivot({ ...base, level: "campaign", range }),
          prev ? loadPivot({ ...base, level: "campaign", range: prev }) : Promise.resolve([]),
          loadDailyTracker({ connectionId: connection.id, brandId: brand.id, range }),
          cirTargets(connection.id),
          db
            .select({ severity: adAlerts.severity, state: adAlerts.state, n: count() })
            .from(adAlerts)
            .where(
              and(
                eq(adAlerts.connectionId, connection.id),
                inArray(adAlerts.state, ["open", "acknowledged"]),
              ),
            )
            .groupBy(adAlerts.severity, adAlerts.state),
          db
            .select({ state: adActions.state, n: count() })
            .from(adActions)
            .where(
              and(
                eq(adActions.connectionId, connection.id),
                inArray(adActions.state, ["pending", "failed"]),
              ),
            )
            .groupBy(adActions.state),
          latestDigest(connection.id),
          recentDigests(connection.id, 7),
        ]);

      const totals = withRates(sumCounters(campaigns.map((c) => c.totals)));
      const prevTotals = prevCampaigns.length
        ? withRates(sumCounters(prevCampaigns.map((c) => c.totals)))
        : null;

      // The funnel split comes from the daily tracker, which is the same source
      // the cockpit's own tracker uses, so the two never disagree.
      const byFunnel = new Map<string, AdTotals[]>();
      for (const row of tracker) {
        const list = byFunnel.get(row.funnel) ?? [];
        list.push(row.totals);
        byFunnel.set(row.funnel, list);
      }

      const funnels: FunnelSlice[] = [...byFunnel.entries()]
        .map(([funnel, list]) => {
          const slice = withRates(sumCounters(list));
          const target = targets.get(funnel);
          return {
            funnel: funnel as Funnel | "UNMAPPED",
            totals: slice,
            targetCirPct: target?.pct ?? null,
            targetConfirmed: target?.confirmed ?? false,
            overTarget: target ? slice.cir > target.pct : false,
          };
        })
        .sort((a, b) => b.totals.spend - a.totals.spend);

      const open = alertRows.filter((r) => r.state === "open");
      return {
        brandId: brand.id,
        brandName: brand.name,
        brandSlug: brand.slug,
        connectionId: connection.id,
        currency,
        adAccountId: account.adAccountId,
        writeGate: account.writeGate,
        totals,
        prevTotals,
        funnels,
        unmappedSpend:
          funnels.find((f) => f.funnel === "UNMAPPED")?.totals.spend ?? 0,
        alerts: {
          open: open.reduce((s, r) => s + r.n, 0),
          critical: open.filter((r) => r.severity === "critical").reduce((s, r) => s + r.n, 0),
          warning: open.filter((r) => r.severity === "warning").reduce((s, r) => s + r.n, 0),
          acknowledged: alertRows
            .filter((r) => r.state === "acknowledged")
            .reduce((s, r) => s + r.n, 0),
        },
        actions: {
          pending: actionRows.find((r) => r.state === "pending")?.n ?? 0,
          failed: actionRows.find((r) => r.state === "failed")?.n ?? 0,
        },
        digest,
        digestHistory: history,
        lastSyncAt: connection.lastSyncAt,
      } satisfies BrandOverview;
    }),
  );
}
