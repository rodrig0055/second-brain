/**
 * Reading the draft context out of the database.
 *
 * Split from ./context so the selection rules there stay importable without a
 * connection string: they are the part with a test, and a test that needs a
 * database is a test nobody runs.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { adAnnotations, adRules } from "@/db/schema";

import { loadPivot, type DateRange } from "../store";
import {
  pickLosers,
  pickWinners,
  spendFloor,
  summariseFunnels,
  type AdSetOption,
  type DraftContext,
} from "./context";

function sum<T>(rows: T[], of: (row: T) => number): number {
  return rows.reduce((total, row) => total + of(row), 0);
}

/**
 * Build the whole context for one brand and window.
 *
 * Reads stored rows only, the same ones the cockpit renders, so opening the
 * brief costs no Meta calls and cannot show a number the table disagrees with.
 */
export async function loadDraftContext(opts: {
  connectionId: string;
  brandId: string;
  brandName: string;
  currency: string;
  range: DateRange;
  windowDays: number;
}): Promise<DraftContext> {
  const { connectionId, brandId, brandName, currency, range, windowDays } = opts;

  const [ads, adSets, rules, annotations] = await Promise.all([
    loadPivot({ connectionId, brandId, level: "ad", range, currency }),
    loadPivot({ connectionId, brandId, level: "adset", range, currency }),
    db.select().from(adRules).where(eq(adRules.connectionId, connectionId)),
    db
      .select()
      .from(adAnnotations)
      .where(
        and(
          eq(adAnnotations.connectionId, connectionId),
          eq(adAnnotations.level, "adset"),
        ),
      ),
  ]);

  const spend = sum(ads, (r) => r.totals.spend);
  const purchaseValue = sum(ads, (r) => r.totals.purchaseValue);
  const floor = spendFloor(spend);

  const funnels = summariseFunnels(ads);
  for (const summary of funnels) {
    const rule = rules.find(
      (r) =>
        r.kind === "cir_over_target" &&
        r.enabled &&
        (r.funnels ?? []).includes(summary.funnel),
    );
    if (!rule) continue;
    summary.targetCirPct = Number(rule.params?.targetPct ?? 0) || null;
    summary.targetConfirmed = Boolean(rule.confirmedAt);
  }

  return {
    brandName,
    currency,
    range,
    windowDays,
    spendFloor: floor,
    totals: {
      spend,
      purchases: sum(ads, (r) => r.totals.purchases),
      purchaseValue,
      cir: purchaseValue > 0 ? (spend / purchaseValue) * 100 : 0,
    },
    funnels,
    winners: pickWinners(ads, { minSpend: floor }),
    losers: pickLosers(ads, { minSpend: floor }),
    adSets: adSetOptions(adSets, annotations),
  };
}

/**
 * Which ad sets a draft can be pointed at.
 *
 * Delivery first, because an ad set that spent this month is one that exists
 * and is switched on. The funnel map is the fallback: ad-set insight rows only
 * started being written recently, so an account whose history predates that has
 * none, and an empty picker would leave a draft that can never be uploaded.
 */
function adSetOptions(
  delivering: Awaited<ReturnType<typeof loadPivot>>,
  annotations: (typeof adAnnotations.$inferSelect)[],
): AdSetOption[] {
  const out: AdSetOption[] = delivering
    .filter((s) => s.totals.spend > 0)
    .map((s) => ({
      id: s.id,
      name: s.name,
      funnel: s.funnel,
      isEventAdSet: s.isEventAdSet,
      spend: s.totals.spend,
      purchases: s.totals.purchases,
      cir: s.totals.cir,
    }));

  const seen = new Set(out.map((s) => s.id));
  for (const a of annotations) {
    if (seen.has(a.entityId)) continue;
    out.push({
      id: a.entityId,
      name: a.entityName || a.audienceLabel || a.entityId,
      funnel: a.funnel,
      isEventAdSet: a.isEventAdSet,
      spend: 0,
      purchases: 0,
      cir: 0,
    });
  }
  return out;
}
