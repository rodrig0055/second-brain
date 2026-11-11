import type { TrackerRow } from "@/lib/ads/store";

/**
 * The daily tracker, one row per funnel per day plus the account total.
 *
 * Replaces the sheet the specialist keeps by hand and transposes into the
 * weekly report. Two things it does that the sheet cannot:
 *
 * TOTAL is read from the account's own daily rows rather than by adding the
 * funnels up, so the two are independent and can disagree. When they do, an
 * UNMAPPED row shows the difference instead of the gap hiding inside whichever
 * funnel someone happens to be reading.
 *
 * A rate with no denominator renders as a dash. In a sheet those cells read as
 * 0% or #DIV/0!, and the first is a lie.
 */

const FUNNEL_ORDER = ["TOTAL", "TOF", "MOF", "BOF", "UNMAPPED"];

function money(value: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function Cell({
  value,
  render,
  denominator,
}: {
  value: number;
  render: (v: number) => string;
  /** When 0, the value is unknown rather than zero. */
  denominator: number;
}) {
  if (denominator <= 0) {
    return (
      <td className="px-3 py-1.5 text-right tabular-nums text-zinc-300" title="No data">
        &mdash;
      </td>
    );
  }
  return (
    <td className="px-3 py-1.5 text-right tabular-nums text-zinc-800">
      {render(value)}
    </td>
  );
}

export function TrackerTable({
  rows,
  currency,
}: {
  rows: TrackerRow[];
  currency: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 px-5 py-9 text-center">
        <p className="text-sm font-medium text-zinc-800">Nothing synced yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-zinc-500">
          The tracker fills in once the daily sync has run for this account.
        </p>
      </div>
    );
  }

  const byDate = new Map<string, TrackerRow[]>();
  for (const row of rows) {
    byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  }
  const dates = [...byDate.keys()].sort().reverse();

  const anyUnmapped = rows.some((r) => r.funnel === "UNMAPPED");

  return (
    <section>
      {anyUnmapped && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          Some ad set spend belongs to no funnel. Until those ad sets are mapped,
          the funnel rows add up to less than the account total.
        </p>
      )}

      <div className="overflow-auto rounded-xl border border-zinc-200 bg-white shadow-card">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Date</th>
              <th className="px-3 py-2 text-left font-medium text-zinc-500">Funnel</th>
              {[
                "Spent",
                "Impr.",
                "Reach",
                "Freq.",
                "CTR",
                "LPV",
                "ATC",
                "IC",
                "Orders",
                "Conv. value",
                "AOV",
                "CIR",
                "ROAS",
                "CPO",
              ].map((label) => (
                <th
                  key={label}
                  className="px-3 py-2 text-right font-medium text-zinc-500"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dates.map((date) => {
              const dayRows = (byDate.get(date) ?? []).sort(
                (a, b) =>
                  FUNNEL_ORDER.indexOf(a.funnel) - FUNNEL_ORDER.indexOf(b.funnel),
              );
              return dayRows.map((row, index) => {
                const t = row.totals;
                const isTotal = row.funnel === "TOTAL";
                return (
                  <tr
                    key={`${date}-${row.funnel}`}
                    className={`border-t border-zinc-100 ${
                      isTotal ? "bg-zinc-50/60 font-medium" : ""
                    } ${index === 0 ? "border-t-zinc-200" : ""}`}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 text-zinc-500">
                      {index === 0 ? date : ""}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-700">
                      {row.funnel === "UNMAPPED" ? (
                        <span className="text-amber-700">unmapped</span>
                      ) : (
                        row.funnel
                      )}
                    </td>
                    <Cell
                      value={t.spend}
                      render={(v) => money(v, currency)}
                      denominator={1}
                    />
                    <Cell
                      value={t.impressions}
                      render={(v) => v.toLocaleString("en-US")}
                      denominator={1}
                    />
                    <Cell
                      value={row.reach.reach}
                      render={(v) =>
                        `${v.toLocaleString("en-US")}${row.reach.exact ? "" : "*"}`
                      }
                      denominator={row.reach.reach}
                    />
                    <Cell
                      value={row.reach.frequency}
                      render={(v) => v.toFixed(2)}
                      denominator={row.reach.reach}
                    />
                    <Cell
                      value={t.ctr}
                      render={(v) => `${v.toFixed(2)}%`}
                      denominator={t.outboundClicks}
                    />
                    <Cell
                      value={t.landingPageViews}
                      render={(v) => v.toLocaleString("en-US")}
                      denominator={1}
                    />
                    <Cell
                      value={t.addToCart}
                      render={(v) => String(v)}
                      denominator={1}
                    />
                    <Cell
                      value={t.initiateCheckout}
                      render={(v) => String(v)}
                      denominator={1}
                    />
                    <Cell
                      value={t.purchases}
                      render={(v) => String(v)}
                      denominator={1}
                    />
                    <Cell
                      value={t.purchaseValue}
                      render={(v) => money(v, currency)}
                      denominator={1}
                    />
                    <Cell
                      value={t.aov}
                      render={(v) => money(v, currency)}
                      denominator={t.purchases}
                    />
                    <Cell
                      value={t.cir}
                      render={(v) => `${v.toFixed(0)}%`}
                      denominator={t.purchaseValue}
                    />
                    <Cell
                      value={t.roas}
                      render={(v) => `${v.toFixed(2)}x`}
                      denominator={t.spend}
                    />
                    <Cell
                      value={t.cpp}
                      render={(v) => money(v, currency)}
                      denominator={t.purchases}
                    />
                  </tr>
                );
              });
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-zinc-400">
        A dash means no data, not zero. An asterisk on reach means it was summed
        across ad sets or days, which counts anyone reached more than once, so
        the true reach is lower and the frequency higher.
      </p>
    </section>
  );
}
