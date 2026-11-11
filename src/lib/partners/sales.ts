/**
 * Partner sales: orders that used a partner's voucher code.
 *
 * Nothing new is synced for this. The Marketing Review's commerce sync already
 * writes one report_daily row per voucher code per day (source "voucher"), from
 * your commerce database, under its sale definition (not a test, not unpaid, not
 * cancelled). This only sums those rows into periods and hands each code to
 * the partner whose pattern matches it.
 */
import { and, desc, eq, gte, lte } from "drizzle-orm";

import { db } from "@/db";
import { reportDaily, reportSyncLog } from "@/db/schema";
import { codeMatcher } from "./codes";
import { periodOf, recentPeriods, type Grain, type Period } from "./periods";

export const SALES_METRICS = ["orders", "revenue", "newCustomers", "voucherCost"] as const;
export type SalesMetric = (typeof SALES_METRICS)[number];

export const METRIC_LABELS: Record<SalesMetric, string> = {
  orders: "Orders",
  revenue: "Revenue",
  newCustomers: "New customers",
  voucherCost: "Voucher cost",
};

/** What each tile counts, behind its info icon. Only orders that used a partner's code count. */
export const METRIC_DEFINITIONS: Record<SalesMetric, string> = {
  orders: "Orders that used one of the partners' voucher codes.",
  revenue: "Order value of the orders that used a partner's code.",
  newCustomers: "First-time customers among the orders that used a partner's code.",
  voucherCost: "The discount the partners' codes gave away.",
};

export type Figures = Record<SalesMetric, number>;

const zero = (): Figures => ({ orders: 0, revenue: 0, newCustomers: 0, voucherCost: 0 });

export type PartnerSales = {
  periods: Period[];
  /** partner id -> period key -> figures */
  byPartner: Map<string, Map<string, Figures>>;
  /** partner id -> code -> orders over the whole window, to show what matched. */
  codesByPartner: Map<string, Map<string, number>>;
  /** Sum over every partner, per period key. */
  totals: Map<string, Figures>;
  syncedAt: Date | null;
};

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

export async function loadPartnerSales(
  brandId: string,
  partnerList: { id: string; codes: string[] }[],
  today: string,
  grain: Grain,
  count: number,
): Promise<PartnerSales> {
  const periods = recentPeriods(today, grain, count);
  const match = codeMatcher(partnerList);
  const [rows, [sync]] = await Promise.all([
    db
      .select({ date: reportDaily.date, code: reportDaily.dimKey, m: reportDaily.m })
      .from(reportDaily)
      .where(
        and(
          eq(reportDaily.brandId, brandId),
          eq(reportDaily.source, "voucher"),
          gte(reportDaily.date, periods[0].start),
          lte(reportDaily.date, periods.at(-1)!.end),
        ),
      ),
    db
      .select({ at: reportSyncLog.finishedAt })
      .from(reportSyncLog)
      .where(and(eq(reportSyncLog.brandId, brandId), eq(reportSyncLog.source, "commerce"), eq(reportSyncLog.status, "ok")))
      .orderBy(desc(reportSyncLog.startedAt))
      .limit(1),
  ]);

  const byPartner = new Map<string, Map<string, Figures>>();
  const codesByPartner = new Map<string, Map<string, number>>();
  const totals = new Map<string, Figures>(periods.map((p) => [p.key, zero()]));

  for (const r of rows) {
    const id = match(r.code);
    if (!id) continue;
    const key = periodOf(r.date, grain).key;
    const per = byPartner.get(id) ?? new Map<string, Figures>();
    byPartner.set(id, per);
    const f = per.get(key) ?? zero();
    per.set(key, f);
    const t = totals.get(key) ?? zero();
    totals.set(key, t);
    const add: Figures = {
      orders: n(r.m.orders),
      revenue: n(r.m.revenue),
      newCustomers: n(r.m.newCustomers),
      voucherCost: n(r.m.voucherCost),
    };
    for (const k of SALES_METRICS) {
      f[k] += add[k];
      t[k] += add[k];
    }
    const codes = codesByPartner.get(id) ?? new Map<string, number>();
    codesByPartner.set(id, codes);
    codes.set(r.code, (codes.get(r.code) ?? 0) + add.orders);
  }

  return { periods, byPartner, codesByPartner, totals, syncedAt: sync?.at ?? null };
}

export function figuresFor(sales: PartnerSales, partnerId: string, periodKey: string): Figures {
  return sales.byPartner.get(partnerId)?.get(periodKey) ?? zero();
}
