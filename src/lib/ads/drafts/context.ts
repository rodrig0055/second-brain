/**
 * What the account already knows, in the shape a brief can use.
 *
 * The point of the ad brief is that a person says what they want to achieve and
 * the rest is suggested from what actually happened. That only works if "what
 * actually happened" is assembled deterministically, here, rather than left to
 * the model to remember or to ask for: the numbers come from the same stored
 * insights the cockpit table reads, so a suggestion can be checked against the
 * row it came from.
 *
 * Nothing in this file calls a model, and nothing in it touches the database:
 * the picks are the part worth testing, and a test must not need a connection
 * string to run them. `loadDraftContext` in ./load-context does the reading.
 */
import type { DateRange, PivotRow } from "../store";

/** The subset of a pivot row this module needs. Keeps the picks testable. */
export type AdLike = Pick<
  PivotRow,
  | "id"
  | "name"
  | "funnel"
  | "totals"
  | "daysActive"
  | "messagingAngle"
  | "hookTactic"
  | "assetType"
  | "creative"
>;

export type FunnelSummary = {
  funnel: string;
  ads: number;
  spend: number;
  purchases: number;
  purchaseValue: number;
  cir: number;
  costPerWarm: number;
  lpvr: number;
  /** From the brand's own CIR rule, when one exists for this funnel. */
  targetCirPct: number | null;
  /** False when the threshold is still a borrowed benchmark. */
  targetConfirmed: boolean;
};

export type AdSetOption = {
  id: string;
  name: string;
  funnel: string | null;
  isEventAdSet: boolean;
  spend: number;
  purchases: number;
  cir: number;
};

export type DraftContext = {
  brandName: string;
  currency: string;
  range: DateRange;
  windowDays: number;
  /** The floor a row had to clear to be called a winner or a loser. */
  spendFloor: number;
  totals: { spend: number; purchases: number; purchaseValue: number; cir: number };
  funnels: FunnelSummary[];
  winners: AdLike[];
  losers: AdLike[];
  adSets: AdSetOption[];
};

/**
 * The spend a row needs before its CIR is worth reading.
 *
 * Bloomly PH runs about $31 a day across six ad sets, so an ad with $3 against
 * it has not had a chance to prove anything either way. One percent of the
 * window's spend scales that with the account instead of hardcoding a number
 * that would be far too low for Acme Florals and far too high for a new brand.
 */
export function spendFloor(totalSpend: number): number {
  return Math.max(5, totalSpend * 0.01);
}

/**
 * The ads worth copying.
 *
 * Purchases are required, not just a low CIR: CIR is spend over revenue, so an
 * ad with no revenue divides by zero and the metric reads 0, which sorts to the
 * top of "best" and would put the account's worst ads in front of the model as
 * the ones to imitate.
 */
export function pickWinners(
  rows: AdLike[],
  opts: { minSpend: number; limit?: number },
): AdLike[] {
  return rows
    .filter((r) => r.totals.spend >= opts.minSpend && r.totals.purchases > 0)
    .sort(
      (a, b) =>
        a.totals.cir - b.totals.cir || b.totals.purchases - a.totals.purchases,
    )
    .slice(0, opts.limit ?? 8);
}

/**
 * The ads worth not repeating.
 *
 * Spend with nothing to show first, because that is the clearest failure and
 * the one the doc's kill rules are written around, then the ones that sold but
 * cost more than they returned.
 */
export function pickLosers(
  rows: AdLike[],
  opts: { minSpend: number; limit?: number },
): AdLike[] {
  const dead = rows.filter(
    (r) => r.totals.spend >= opts.minSpend && r.totals.purchases === 0,
  );
  const expensive = rows.filter(
    (r) =>
      r.totals.spend >= opts.minSpend &&
      r.totals.purchases > 0 &&
      r.totals.cir > 100,
  );
  return [
    ...dead.sort((a, b) => b.totals.spend - a.totals.spend),
    ...expensive.sort((a, b) => b.totals.cir - a.totals.cir),
  ].slice(0, opts.limit ?? 5);
}

/** Roll ad rows up per funnel. Unmapped ads are left out rather than guessed. */
export function summariseFunnels(rows: AdLike[]): FunnelSummary[] {
  const byFunnel = new Map<string, AdLike[]>();
  for (const row of rows) {
    if (!row.funnel) continue;
    const list = byFunnel.get(row.funnel) ?? [];
    list.push(row);
    byFunnel.set(row.funnel, list);
  }

  const out: FunnelSummary[] = [];
  for (const [funnel, list] of byFunnel) {
    const spend = sum(list, (r) => r.totals.spend);
    const purchaseValue = sum(list, (r) => r.totals.purchaseValue);
    const warm = sum(list, (r) => r.totals.warm);
    const lpv = sum(list, (r) => r.totals.landingPageViews);
    const outbound = sum(list, (r) => r.totals.outboundClicks);
    out.push({
      funnel,
      ads: list.length,
      spend,
      purchases: sum(list, (r) => r.totals.purchases),
      purchaseValue,
      // Ratios of sums, never averages of ratios: a mean of per-ad CIRs weights
      // a $2 ad the same as a $200 one.
      cir: purchaseValue > 0 ? (spend / purchaseValue) * 100 : 0,
      costPerWarm: warm > 0 ? spend / warm : 0,
      lpvr: outbound > 0 ? (lpv / outbound) * 100 : 0,
      targetCirPct: null,
      targetConfirmed: false,
    });
  }
  return out.sort((a, b) => b.spend - a.spend);
}

function sum<T>(rows: T[], of: (row: T) => number): number {
  return rows.reduce((total, row) => total + of(row), 0);
}

const money = (v: number, currency: string) =>
  `${currency === "USD" ? "$" : ""}${v.toFixed(2)}${currency === "USD" ? "" : ` ${currency}`}`;

function adLine(row: AdLike, currency: string): string {
  const t = row.totals;
  const labels = [row.assetType, row.messagingAngle, row.hookTactic]
    .filter(Boolean)
    .join(" / ");
  const parts = [
    `- "${row.name}" [${row.funnel ?? "unmapped"}]`,
    `${money(t.spend, currency)} spent, ${t.purchases} purchases`,
    t.purchaseValue > 0 ? `CIR ${t.cir.toFixed(0)}%` : "no revenue",
    `${t.warm} add-to-cart/checkout`,
    `${row.daysActive}d active`,
  ];
  const lines = [parts.join(" · ")];
  if (labels) lines.push(`  labels: ${labels}`);
  if (row.creative?.title) lines.push(`  headline: ${row.creative.title}`);
  if (row.creative?.body) {
    lines.push(`  copy: ${row.creative.body.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  if (row.creative?.callToAction) lines.push(`  button: ${row.creative.callToAction}`);
  return lines.join("\n");
}

/**
 * The context as the block that goes into the prompt.
 *
 * Plain text rather than JSON: the model reads it once and every number in it
 * is also on screen for the person, so the two cannot drift apart.
 */
export function briefText(ctx: DraftContext): string {
  const c = ctx.currency;
  const lines: string[] = [
    `# What ${ctx.brandName}'s Meta account did over the last ${ctx.windowDays} days (${ctx.range.start} to ${ctx.range.end})`,
    ``,
    `Account total: ${money(ctx.totals.spend, c)} spent, ${ctx.totals.purchases} purchases, ` +
      `${money(ctx.totals.purchaseValue, c)} revenue, CIR ${ctx.totals.cir.toFixed(0)}%.`,
    `CIR is spend over revenue as a percentage: lower is better, and over 100% loses money.`,
    ``,
    `## By funnel`,
  ];

  if (ctx.funnels.length === 0) {
    lines.push(`No ads are mapped to a funnel yet, so there is nothing to compare against.`);
  }
  for (const f of ctx.funnels) {
    const target = f.targetCirPct
      ? ` · target CIR ${f.targetCirPct}%${f.targetConfirmed ? "" : " (borrowed benchmark, not confirmed for this brand)"}`
      : ` · no CIR target set`;
    // A rate with no denominator is 0, and 0 here would read as "nobody ever
    // reached the landing page" rather than "that column was not synced".
    const parts = [
      `- ${f.funnel}: ${money(f.spend, c)} over ${f.ads} ads, ${f.purchases} purchases`,
      `CIR ${f.cir > 0 ? `${f.cir.toFixed(0)}%` : "n/a"}`,
    ];
    if (f.costPerWarm > 0) {
      parts.push(`cost per add-to-cart/checkout ${money(f.costPerWarm, c)}`);
    }
    if (f.lpvr > 0) parts.push(`landing page view rate ${f.lpvr.toFixed(0)}%`);
    lines.push(parts.join(", ") + target);
  }

  lines.push(
    ``,
    `## Ads that worked (at least ${money(ctx.spendFloor, c)} spent and at least one purchase, best CIR first)`,
  );
  lines.push(
    ctx.winners.length
      ? ctx.winners.map((r) => adLine(r, c)).join("\n")
      : `None cleared the spend floor with a purchase. Say so rather than inventing a winner.`,
  );

  lines.push(``, `## Ads that did not work (same spend floor)`);
  lines.push(
    ctx.losers.length
      ? ctx.losers.map((r) => adLine(r, c)).join("\n")
      : `None, over this window.`,
  );

  lines.push(
    ``,
    `## Ad sets this ad could go into (id · name · funnel · spend in the window)`,
  );
  lines.push(
    ctx.adSets.length
      ? ctx.adSets
          .map(
            (s) =>
              `- ${s.id} · ${s.name} · ${s.funnel ?? "unmapped"}${s.isEventAdSet ? " (event ad set)" : ""} · ${money(s.spend, c)}, ${s.purchases} purchases`,
          )
          .join("\n")
      : `- none delivering in this window`,
  );
  lines.push(
    ``,
    `Use an ad set id exactly as written above. Never invent one: the id decides`,
    `which audience and budget the ad lands in, and a wrong one spends real money`,
    `on the wrong people.`,
  );

  return lines.join("\n");
}
