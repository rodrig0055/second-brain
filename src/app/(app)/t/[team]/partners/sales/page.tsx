import Link from "next/link";
import { TrendingUp } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { PartnerStatusBadge } from "@/components/partners/bits";
import { formatMoney, formatNumber } from "@/lib/insights/format";
import { loadPartners, today } from "@/lib/partners/data";
import { partnerPath, partnersPath, requirePartnershipsTeam } from "@/lib/partners/gate";
import { PARTNERS_CURRENCY } from "@/lib/partners/model";
import type { Grain } from "@/lib/partners/periods";
import { METRIC_DEFINITIONS, METRIC_LABELS, SALES_METRICS, figuresFor, loadPartnerSales, type SalesMetric } from "@/lib/partners/sales";

type Search = { grain?: string; metric?: string };

const PERIODS_SHOWN: Record<Grain, number> = { half: 6, month: 6 };

function href(current: Search, patch: Search): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...patch })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "?";
}

function Seg({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5">
      {items.map((i) => (
        <Link
          key={i.label}
          href={i.href}
          className={`rounded-md px-2.5 py-1 text-xs ${i.active ? "bg-zinc-900 text-zinc-50" : "text-zinc-600 hover:text-zinc-900"}`}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

function fmt(metric: SalesMetric, v: number): string {
  return metric === "revenue" || metric === "voucherCost" ? formatMoney(v, PARTNERS_CURRENCY) : formatNumber(v);
}

function syncedLabel(at: Date | null): string {
  if (!at) return "not synced yet";
  return at.toLocaleString("en-SG", {
    timeZone: "Asia/Singapore",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function PartnerSalesPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Search>;
}) {
  const { team: teamSlug } = await params;
  const { brand } = await requirePartnershipsTeam(teamSlug);
  const search = await searchParams;
  const grain: Grain = search.grain === "month" ? "month" : "half";
  const metric: SalesMetric = SALES_METRICS.includes(search.metric as SalesMetric) ? (search.metric as SalesMetric) : "orders";
  const now = today();

  const all = await loadPartners(brand.id);
  const withCodes = all.filter((p) => p.codes.length > 0);
  const sales = await loadPartnerSales(brand.id, withCodes, now, grain, PERIODS_SHOWN[grain]);
  const { periods } = sales;
  const current = periods.at(-1)!;
  // Compare complete periods: the running one is always short.
  const last = periods.at(-2)!;
  const before = periods.at(-3)!;
  const tot = (key: string) => sales.totals.get(key) ?? { orders: 0, revenue: 0, newCustomers: 0, voucherCost: 0 };

  const rows = withCodes
    .map((p) => {
      const cells = periods.map((per) => figuresFor(sales, p.id, per.key)[metric]);
      return { p, cells, total: cells.reduce((a, b) => a + b, 0) };
    })
    .sort((a, b) => b.total - a.total || a.p.name.localeCompare(b.p.name));
  const max = Math.max(1, ...rows.flatMap((r) => r.cells));
  const livePartnersWithoutCode = all.filter((p) => p.status === "live" && p.codes.length === 0);
  const unit = grain === "half" ? "half-month" : "month";

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title="Partner sales"
        description={`Orders that used each partner's voucher codes, ${grain === "half" ? "by half-month (1st to 15th, 16th to month end; two make a month)" : "by month"}. Paid orders only, from the commerce database. Last synced ${syncedLabel(sales.syncedAt)}.`}
        action={
          <Seg
            items={[
              { href: href(search, { grain: "" }), label: "Half-month", active: grain === "half" },
              { href: href(search, { grain: "month" }), label: "Month", active: grain === "month" },
            ]}
          />
        }
      />

      {withCodes.length === 0 ? (
        <EmptyState
          icon={<TrendingUp className="size-4" />}
          title="No partner has a voucher code yet"
          description="Sales are counted from each partner's codes. Add a code on a partner's page and its orders show up here."
          action={
            <Button href={partnersPath()} label="Go to partners" variant="primary" size="sm" />
          }
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-zinc-500">
            All partners, {last.label} (last complete {unit}) against {before.label}
          </p>
          <KpiGrid cols={4}>
            {SALES_METRICS.map((m) => (
              <KpiTile
                key={m}
                label={METRIC_LABELS[m]}
                definition={METRIC_DEFINITIONS[m]}
                value={tot(last.key)[m]}
                previous={tot(before.key)[m]}
                format={m === "revenue" || m === "voucherCost" ? "money" : "number"}
                currency={PARTNERS_CURRENCY}
                invert={m === "voucherCost"}
                compareLabel={`vs ${before.label}`}
                hint={`${current.label} so far: ${fmt(m, tot(current.key)[m])}`}
                href={href(search, { metric: m === "orders" ? "" : m })}
              />
            ))}
          </KpiGrid>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-zinc-800">By partner: {METRIC_LABELS[metric].toLowerCase()}</h2>
            <Seg
              items={SALES_METRICS.map((m) => ({
                href: href(search, { metric: m === "orders" ? "" : m }),
                label: METRIC_LABELS[m],
                active: metric === m,
              }))}
            />
          </div>

          <div className="mt-2 overflow-auto rounded-xl border border-zinc-200 bg-white shadow-card">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-zinc-500">
                    Partner
                  </th>
                  {periods.map((per, i) => (
                    <th
                      key={per.key}
                      className="whitespace-nowrap border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-right text-[0.6875rem] font-semibold uppercase tracking-wide text-zinc-500"
                    >
                      {per.label}
                      {i === periods.length - 1 && <span className="block font-normal normal-case text-zinc-400">so far</span>}
                    </th>
                  ))}
                  <th className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-right text-[0.6875rem] font-semibold uppercase tracking-wide text-zinc-500">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, cells, total }) => (
                  <tr key={p.id} className="hover:bg-zinc-50">
                    <td className="sticky left-0 border-b border-zinc-100 bg-white px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Link href={partnerPath(p.id)} className="whitespace-nowrap font-medium text-zinc-900 underline-offset-2 hover:underline">
                          {p.name}
                        </Link>
                        {p.status !== "live" && <PartnerStatusBadge status={p.status} />}
                      </div>
                    </td>
                    {cells.map((v, i) => (
                      <td key={periods[i].key} className="border-b border-zinc-100 px-3 py-2 text-right">
                        <span className="relative inline-block w-20 text-right">
                          {/* A bar behind the number, so the size reads before the digits do. */}
                          <span
                            aria-hidden
                            className="absolute inset-y-0 right-0 rounded bg-emerald-100"
                            style={{ width: `${v > 0 ? Math.max(8, (v / max) * 100) : 0}%` }}
                          />
                          <span className={`relative px-1 ${v === 0 ? "text-zinc-300" : "text-zinc-800"}`}>{fmt(metric, v)}</span>
                        </span>
                      </td>
                    ))}
                    <td className="border-b border-zinc-100 px-3 py-2 text-right font-medium text-zinc-900">{fmt(metric, total)}</td>
                  </tr>
                ))}
                <tr className="bg-zinc-50 font-medium">
                  <td className="sticky left-0 bg-zinc-50 px-3 py-2 text-zinc-700">All partners</td>
                  {periods.map((per) => (
                    <td key={per.key} className="px-3 py-2 text-right text-zinc-900">
                      {fmt(metric, tot(per.key)[metric])}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right text-zinc-900">
                    {fmt(metric, periods.reduce((a, per) => a + tot(per.key)[metric], 0))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {livePartnersWithoutCode.length > 0 && (
            <p className="mt-3 text-xs text-zinc-500">
              Live without a code, so not counted:{" "}
              {livePartnersWithoutCode.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ", "}
                  <Link href={partnerPath(p.id)} className="underline underline-offset-2 hover:text-zinc-900">
                    {p.name}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
        </>
      )}
    </div>
  );
}
