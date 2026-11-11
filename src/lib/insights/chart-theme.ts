// Recharts theme tokens, aligned to the app's design system (dark zinc surfaces,
// emerald = revenue/positive, zinc = spend/neutral). No gradients, no dashes —
// quiet competence. Imported by the "use client" chart wrappers.

export const CHART = {
  grid: "rgba(24,24,27,0.08)",
  axisText: "#71717a",
  revenue: "#059669",
  spend: "#71717a",
  positive: "#059669",
  negative: "#e11d48",
} as const;

// Shared axis props so every chart reads identically.
export const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: CHART.axisText, fontSize: 11 },
} as const;

export const gridProps = {
  stroke: CHART.grid,
  vertical: false,
} as const;

/** MM-DD tick label from a YYYY-MM-DD string. */
export function dayTick(date: string): string {
  return date.slice(5);
}
