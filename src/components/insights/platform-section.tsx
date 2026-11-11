import {
  MONEY_METRICS,
  METRIC_LABELS,
  type InsightPlatform,
  type MetricKey,
} from "@/lib/insights/platforms";
import {
  deltaPct,
  formatMoney,
  type PlatformData,
} from "@/lib/insights/data";
import { EmptyPlatform } from "./empty-platform";
import { PlatformSparkline } from "./platform-sparkline";

/**
 * One platform's section. Populated when it has rows in the window (its metric
 * tiles + a trend sparkline of the headline metric), otherwise the empty state.
 */
export function PlatformSection({
  spec,
  data,
  isAdmin,
}: {
  spec: InsightPlatform;
  data?: PlatformData;
  isAdmin: boolean;
}) {
  if (!data || !data.hasData) {
    return <EmptyPlatform spec={spec} data={data} isAdmin={isAdmin} />;
  }

  const spark = data.series.map((p) => ({ value: p[spec.primaryMetric] }));
  const sparkPositive = spec.primaryMetric !== "spend";

  return (
    <div className="animate-enter rounded-lg border border-zinc-200 bg-white p-4 shadow-card">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="text-zinc-500">
          {spec.glyph}
        </span>
        <h3 className="text-sm font-medium text-zinc-900">{spec.label}</h3>
        {data.currency && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.65rem] tabular-nums text-zinc-600">
            {data.currency}
          </span>
        )}
        <div className="ml-auto h-10 w-28">
          <PlatformSparkline data={spark} positive={sparkPositive} />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 md:grid-cols-5">
        {spec.metrics.map((m) => (
          <MetricTile key={m} metric={m} data={data} />
        ))}
      </div>
    </div>
  );
}

function MetricTile({ metric, data }: { metric: MetricKey; data: PlatformData }) {
  const value = data.totals[metric];
  const prev = data.prevTotals[metric];
  const isMoney = MONEY_METRICS.has(metric);
  const display = isMoney
    ? formatMoney(value, data.currency)
    : value.toLocaleString("en-PH");
  const delta = deltaPct(value, prev);
  // Spend up = not inherently good; everything else up = good.
  const invert = metric === "spend";

  return (
    <div>
      <p className="text-[0.7rem] text-zinc-500">{METRIC_LABELS[metric]}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums text-zinc-900">
        {display}
      </p>
      {delta !== null && (
        <DeltaText delta={delta} invert={invert} />
      )}
    </div>
  );
}

function DeltaText({ delta, invert }: { delta: number; invert: boolean }) {
  const up = delta >= 0;
  const good = invert ? !up : up;
  const tone =
    delta === 0 ? "text-zinc-400" : good ? "text-emerald-700" : "text-red-400/80";
  return (
    <span className={`text-[0.65rem] tabular-nums ${tone}`}>
      {delta === 0 ? "" : up ? "↑" : "↓"}
      {Math.abs(delta * 100).toFixed(0)}%
    </span>
  );
}
