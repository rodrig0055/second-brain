import type { DataTableColumn } from "@/components/data-table";
import type { PivotRow } from "@/lib/ads/store";

/**
 * The pivot's columns, on the shared table.
 *
 * These are the columns the tracking sheet carried, kept because they are the
 * ones the specialist already reads down. Every rate is null rather than zero
 * when its denominator is zero: a CIR with no revenue is not 0%, it is not a
 * ratio at all, and a zero would sort it to the top of a "best CIR" sort.
 */

const money = (value: number | string, row: PivotRow) =>
  `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${row.currency}`;

const pct = (value: number | string) => {
  const n = Number(value);
  return `${n.toFixed(n < 10 ? 1 : 0)}%`;
};

const count = (value: number | string) => Number(value).toLocaleString("en-US");

const rateOrNull = (value: number, denominator: number): number | null =>
  denominator > 0 ? value : null;

export const PERFORMANCE_COLUMNS: DataTableColumn<PivotRow>[] = [
  { key: "spend", label: "Spent", value: (r) => r.totals.spend, format: money, numeric: true },
  {
    key: "cir",
    label: "CIR",
    value: (r) => rateOrNull(r.totals.cir, r.totals.purchaseValue),
    format: pct,
    numeric: true,
    lowerIsBetter: true,
  },
  {
    key: "roas",
    label: "ROAS",
    value: (r) => rateOrNull(r.totals.roas, r.totals.spend),
    format: (v) => `${Number(v).toFixed(2)}x`,
    numeric: true,
  },
  { key: "purchases", label: "Purch.", value: (r) => r.totals.purchases, format: count, numeric: true },
  {
    key: "purchaseValue",
    label: "Conv. value",
    value: (r) => r.totals.purchaseValue,
    format: money,
    numeric: true,
  },
  {
    key: "cpp",
    label: "Cost/purch.",
    value: (r) => rateOrNull(r.totals.cpp, r.totals.purchases),
    format: money,
    numeric: true,
    lowerIsBetter: true,
  },
  {
    key: "aov",
    label: "AOV",
    value: (r) => rateOrNull(r.totals.aov, r.totals.purchases),
    format: money,
    numeric: true,
    defaultVisible: false,
  },
  {
    key: "ctr",
    label: "CTR",
    value: (r) => rateOrNull(r.totals.ctr, r.totals.outboundClicks),
    format: (v) => `${Number(v).toFixed(2)}%`,
    numeric: true,
  },
  {
    key: "lpvr",
    label: "LPVr",
    value: (r) => rateOrNull(r.totals.lpvr, r.totals.outboundClicks),
    format: pct,
    numeric: true,
  },
  { key: "warm", label: "ATC+IC", value: (r) => r.totals.warm, format: count, numeric: true },
  {
    key: "costPerWarm",
    label: "Cost/warm",
    value: (r) => rateOrNull(r.totals.costPerWarm, r.totals.warm),
    format: money,
    numeric: true,
    lowerIsBetter: true,
  },
  {
    key: "impressions",
    label: "Impr.",
    value: (r) => r.totals.impressions,
    format: count,
    numeric: true,
    defaultVisible: false,
  },
  {
    key: "frequency",
    label: "Freq.",
    value: (r) => (r.reach.reach > 0 ? r.reach.frequency : null),
    // The star means the window spans several days, so reach is a sum and
    // anyone seen twice was counted twice.
    format: (v, r) => `${Number(v).toFixed(2)}${r.reach.exact ? "" : "*"}`,
    numeric: true,
    lowerIsBetter: true,
    defaultVisible: false,
  },
  {
    key: "cpm",
    label: "CPM",
    value: (r) => rateOrNull(r.totals.cpm, r.totals.impressions),
    format: money,
    numeric: true,
    lowerIsBetter: true,
    defaultVisible: false,
  },
  {
    key: "hookRate",
    label: "Hook",
    value: (r) => rateOrNull(r.totals.hookRate, r.totals.videoViews3s),
    format: pct,
    numeric: true,
    defaultVisible: false,
  },
  {
    key: "holdRate",
    label: "Hold",
    value: (r) => rateOrNull(r.totals.holdRate, r.totals.videoViews3s),
    format: pct,
    numeric: true,
    defaultVisible: false,
  },
  { key: "daysActive", label: "Days", value: (r) => r.daysActive, format: count, numeric: true },
];

/** Deltas against the previous window, shown only when comparing. */
export const COMPARE_COLUMNS: DataTableColumn<PivotRow>[] = [
  {
    key: "spendDelta",
    label: "Spend Δ",
    value: (r) => (r.prevTotals ? r.totals.spend - r.prevTotals.spend : null),
    format: (v, r) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(0)} ${r.currency}`,
    numeric: true,
  },
  {
    key: "purchasesDelta",
    label: "Purch. Δ",
    value: (r) => (r.prevTotals ? r.totals.purchases - r.prevTotals.purchases : null),
    format: (v) => `${Number(v) > 0 ? "+" : ""}${Number(v)}`,
    numeric: true,
  },
  {
    key: "cirDelta",
    label: "CIR Δ",
    value: (r) =>
      r.prevTotals && r.prevTotals.purchaseValue > 0 && r.totals.purchaseValue > 0
        ? r.totals.cir - r.prevTotals.cir
        : null,
    format: (v) => `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(0)}pp`,
    numeric: true,
    lowerIsBetter: true,
  },
];
