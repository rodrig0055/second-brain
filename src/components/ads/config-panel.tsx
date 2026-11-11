"use client";

/**
 * How this entity is set up, as opposed to how it performed.
 *
 * Everything else in the drawer comes from `metrics_daily`, which is built
 * from the Insights API and reports delivery. Insights has never returned
 * objective, budget, bid strategy, schedule or targeting, so until the
 * `ad_entities` mirror existed the workspace could not answer the first
 * question anyone asks about an underperforming ad set.
 *
 * The mirror's age is shown next to the values rather than hidden. A budget
 * read this morning and a budget read last week are different claims, and the
 * second is the one that makes somebody propose a change against a number that
 * has already moved.
 */

export type EntityConfig = {
  status: string;
  effectiveStatus: string;
  objective: string;
  buyingType: string;
  bidStrategy: string;
  billingEvent: string;
  optimizationGoal: string;
  currency: string;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  budgetRemaining: number | null;
  bidAmount: number | null;
  startTime: string | null;
  stopTime: string | null;
  targeting: Record<string, unknown> | null;
  promotedObject: Record<string, unknown> | null;
  fetchedAt: string;
};

/** Meta's enum spellings are shouty and underscored; people are not. */
function pretty(value: string): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function age(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function date(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** The parts of a targeting spec a person actually reads at a glance. */
function targetingSummary(spec: Record<string, unknown> | null): string[] {
  if (!spec) return [];
  const out: string[] = [];

  const geo = spec.geo_locations as { countries?: string[]; cities?: unknown[] } | undefined;
  if (geo?.countries?.length) out.push(geo.countries.join(", "));
  if (geo?.cities?.length) out.push(`${geo.cities.length} city/cities`);

  const min = spec.age_min as number | undefined;
  const max = spec.age_max as number | undefined;
  if (min || max) out.push(`Age ${min ?? "?"}–${max ?? "?"}`);

  const genders = spec.genders as number[] | undefined;
  if (genders?.length === 1) out.push(genders[0] === 1 ? "Men" : "Women");

  const platforms = spec.publisher_platforms as string[] | undefined;
  if (platforms?.length) out.push(platforms.map(pretty).join(", "));

  const custom = spec.custom_audiences as unknown[] | undefined;
  if (custom?.length) out.push(`${custom.length} custom audience(s)`);
  const excluded = spec.excluded_custom_audiences as unknown[] | undefined;
  if (excluded?.length) out.push(`${excluded.length} excluded`);

  return out;
}

export function ConfigPanel({
  config,
  level,
}: {
  config: EntityConfig | null;
  level: string;
}) {
  if (!config) {
    return (
      <div className="mt-4 rounded-lg border border-dashed border-zinc-200 p-3">
        <p className="text-xs text-zinc-500">
          {level === "ad"
            ? // Not a gap. Budget, targeting, bid and schedule are all ad-set
              // and campaign fields; an ad has none of its own, so mirroring
              // them was 83% of the work for nothing anyone could read.
              "An ad has no configuration of its own. Its budget, targeting and schedule belong to the ad set above it, on the Setup panel there."
            : `No configuration stored for this ${level} yet. It arrives with the next Meta sync.`}
        </p>
      </div>
    );
  }

  // Zero is Meta's way of saying "not set" on a budget field, not a budget of
  // nothing: a live ad set with a 5 USD daily budget reports lifetime_budget
  // as "0". Showing it renders an absence as a value somebody set.
  const money = (v: number | null) =>
    v === null || v === 0
      ? null
      : `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${config.currency}`;

  // Only what this level actually has. A column that is always empty is worse
  // than one that is absent: it reads as a missing value rather than a
  // meaningless one.
  const fields: [string, string | null][] = [
    ["Status", pretty(config.status)],
    [
      "Delivery",
      config.effectiveStatus && config.effectiveStatus !== config.status
        ? pretty(config.effectiveStatus)
        : null,
    ],
    ["Objective", pretty(config.objective) || null],
    ["Buying", pretty(config.buyingType) || null],
    ["Daily budget", money(config.dailyBudget)],
    ["Lifetime budget", money(config.lifetimeBudget)],
    ["Budget left", money(config.budgetRemaining)],
    ["Bid strategy", pretty(config.bidStrategy) || null],
    ["Bid cap", money(config.bidAmount)],
    ["Optimising for", pretty(config.optimizationGoal) || null],
    ["Billed on", pretty(config.billingEvent) || null],
    ["Starts", date(config.startTime)],
    ["Ends", date(config.stopTime)],
  ];
  const shown = fields.filter((f): f is [string, string] => Boolean(f[1]));
  const targeting = targetingSummary(config.targeting);
  const event = (config.promotedObject?.custom_event_type as string) ?? "";

  return (
    <div className="mt-4 rounded-lg border border-zinc-200 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Configuration
        </h4>
        <span className="text-[11px] text-zinc-400" title={config.fetchedAt}>
          read {age(config.fetchedAt)}
        </span>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {shown.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2 text-xs">
            <dt className="text-zinc-500">{label}</dt>
            <dd className="text-right font-medium text-zinc-800">{value}</dd>
          </div>
        ))}
      </dl>

      {event && (
        <p className="mt-2 text-xs text-zinc-500">
          Conversion event{" "}
          <span className="font-medium text-zinc-800">{pretty(event)}</span>
        </p>
      )}

      {targeting.length > 0 && (
        <div className="mt-2 border-t border-zinc-100 pt-2">
          <p className="text-[11px] uppercase tracking-wide text-zinc-400">
            Targeting
          </p>
          <p className="mt-0.5 text-xs text-zinc-700">{targeting.join(" · ")}</p>
        </div>
      )}

      {level === "adset" &&
        config.dailyBudget === null &&
        config.lifetimeBudget === null && (
          // Only meaningful for an ad set. An ad never carries a budget at all,
          // so saying this there would explain an absence that was never a
          // question.
          <p className="mt-2 text-[11px] text-zinc-400">
            No budget here, so the campaign carries it. Changing it moves every
            ad set under that campaign.
          </p>
        )}
    </div>
  );
}
