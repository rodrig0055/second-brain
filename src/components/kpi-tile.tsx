import type { ReactNode } from "react";
import { Card } from "@astryxdesign/core/Card";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack } from "@astryxdesign/core/HStack";
import { InfoTip } from "@astryxdesign/core/InfoTip";
import { Link } from "@astryxdesign/core/Link";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  deltaPct,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRatio,
} from "@/lib/insights/format";
import { metricDefinition } from "@/lib/metrics/definitions";
import { KpiSparkline } from "@/components/kpi-sparkline";
import { ToneTag } from "@/components/status-badge";

/**
 * One number, with what it was last period.
 *
 * A number on its own is not actionable: 12 posts is good or bad only next to
 * the 20 before it. So the delta is part of the tile rather than a separate
 * feature, and `invert` marks the metrics where down is the good direction.
 *
 * Money never adds across currencies. Pass `byCurrency` for a scope that spans
 * PHP and USD and the tile shows both lines, because there is no FX in this app
 * and a single blended figure would be a made-up number.
 *
 * The info icon carries what the number means. It comes from the metric
 * glossary (`lib/metrics/definitions.ts`) by label; pass `definition` to say
 * something more specific, or `null` for a label the glossary would misread.
 */

export type KpiFormat = "number" | "money" | "percent" | "ratio" | ((value: number) => string);

export type KpiTileProps = {
  label: string;
  value: number | string | null;
  format?: KpiFormat;
  currency?: string;
  byCurrency?: Record<string, number>;
  previous?: number | null;
  delta?: number | null;
  /** Lower is better: spend, CPA, CIR, frequency. */
  invert?: boolean;
  compareLabel?: string;
  hint?: ReactNode;
  /** What the number means. Defaults to the glossary entry for `label`; null hides it. */
  definition?: string | null;
  spark?: { value: number }[];
  sparkPositive?: boolean;
  size?: "sm" | "md";
  href?: string;
  tone?: "default" | "warn";
};

function render(value: number, format: KpiFormat | undefined, currency?: string): string {
  if (typeof format === "function") return format(value);
  switch (format) {
    case "money":
      return formatMoney(value, currency ?? "");
    case "percent":
      return formatPercent(value);
    case "ratio":
      return formatRatio(value);
    default:
      return formatNumber(value);
  }
}

export function KpiTile({
  label,
  value,
  format = "number",
  currency,
  byCurrency,
  previous,
  delta,
  invert = false,
  compareLabel,
  hint,
  definition,
  spark,
  sparkPositive,
  size = "md",
  href,
  tone = "default",
}: KpiTileProps) {
  const currencies = byCurrency ? Object.entries(byCurrency).filter(([, v]) => v !== 0) : [];
  const mixed = currencies.length > 1;
  const meaning = definition === undefined ? metricDefinition(label) : definition;

  const change =
    delta !== undefined
      ? delta
      : typeof value === "number" && typeof previous === "number"
        ? deltaPct(value, previous)
        : null;

  const valueSize = size === "sm" ? "sm" : "lg";
  const valueClass = tone === "warn" ? "text-warning" : undefined;

  const body = (
    <VStack gap={0.5} className={href && size === "sm" ? "relative" : undefined}>
      <HStack gap={1} vAlign="center">
        {href ? (
          // A stretched link: the whole tile is the target, the info icon sits above it.
          <Link href={href} className="min-w-0 text-secondary after:absolute after:inset-0">
            <Text type="supporting" color="inherit">
              {label}
            </Text>
          </Link>
        ) : (
          <Text type="supporting">{label}</Text>
        )}
        {meaning && (
          <HStack className="relative z-10">
            <InfoTip size="xsm" label={`About ${label}`} content={meaning} />
          </HStack>
        )}
      </HStack>

      {mixed ? (
        <VStack gap={0.5}>
          {currencies.map(([cur, amount]) => (
            <Text key={cur} size={valueSize} weight="medium" hasTabularNumbers>
              {formatMoney(amount, cur)}
            </Text>
          ))}
          <ToneTag tone="attention" label="Mixed currencies" />
        </VStack>
      ) : (
        <Text as="p" size={valueSize} weight="medium" hasTabularNumbers className={valueClass}>
          {value === null || value === undefined ? (
            <Text color="disabled" aria-label="No data">
              —
            </Text>
          ) : typeof value === "string" ? (
            value
          ) : currencies.length === 1 ? (
            formatMoney(currencies[0][1], currencies[0][0])
          ) : (
            render(value, format, currency)
          )}
        </Text>
      )}

      {(change !== null || compareLabel) && (
        // One flowing line, so a narrow tile wraps words rather than splitting into columns.
        <Text as="p" type="supporting">
          <DeltaPill delta={change} invert={invert} />
          {change !== null && compareLabel ? ` ${compareLabel}` : ""}
        </Text>
      )}

      {hint && (
        <Text as="div" type="supporting">
          {hint}
        </Text>
      )}
      {spark && spark.length > 1 && <KpiSparkline data={spark} positive={sparkPositive ?? !invert} />}
    </VStack>
  );

  if (size === "sm") return body;
  return (
    <Card padding={3} className={`animate-enter ${href ? "relative hover:border-border-strong" : ""}`}>
      {body}
    </Card>
  );
}

/** Tiles side by side: two on a phone, up to `cols` when there is room. */
export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 | 6 }) {
  return (
    <Grid columns={{ minWidth: 120, max: cols }} gap={2}>
      {children}
    </Grid>
  );
}

/**
 * Green is not "up": on spend or CPA, up is bad. `invert` is what makes the
 * colour mean "better" rather than "larger".
 */
export function DeltaPill({
  delta,
  invert = false,
  label,
}: {
  delta: number | null;
  invert?: boolean;
  label?: string;
}) {
  if (delta === null) {
    return (
      <Text type="supporting" color="disabled">
        {label ?? "no baseline"}
      </Text>
    );
  }
  const rounded = Math.abs(delta) < 0.0005 ? 0 : delta;
  const better = invert ? rounded < 0 : rounded > 0;
  const tone = rounded === 0 ? "text-secondary" : better ? "text-success" : "text-error";
  const sign = rounded > 0 ? "+" : "";
  return (
    <Text type="supporting" weight="medium" hasTabularNumbers color="inherit" className={tone}>
      {sign}
      {(rounded * 100).toFixed(rounded === 0 ? 0 : 1)}%
    </Text>
  );
}
