// Client-safe pure helpers shared by server and "use client" components. Keep
// this module free of server-only imports (no db, no "server-only") so it can be
// bundled into the Recharts client wrappers.

export function formatMoney(amount: number, currency: string): string {
  if (!currency)
    return amount.toLocaleString("en-PH", { maximumFractionDigits: 0 });
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency,
      maximumFractionDigits: amount >= 1000 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
  }
}

export function formatCompactMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: currency || "USD",
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return String(Math.round(amount));
  }
}

/** WoW delta as a fraction (0.12 = +12%), or null when there's no baseline. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-PH", { maximumFractionDigits: 0 });
}

/** A fraction as a percentage: 0.1234 -> "12.3%". */
export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatRatio(n: number, suffix = "\u00d7"): string {
  return `${n.toFixed(2)}${suffix}`;
}

/**
 * Sum money per currency. Never across them: there is no FX anywhere in this
 * app, so PHP and USD are two numbers, not one wrong one.
 */
export function sumByCurrency<T>(
  rows: T[],
  amount: (row: T) => number,
  currency: (row: T) => string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const cur = currency(row) || "";
    out[cur] = (out[cur] ?? 0) + amount(row);
  }
  return out;
}
