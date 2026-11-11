"use client";

import type { EvalMetric } from "@/lib/integrations/meta/creative-dashboard-types";
import { QueryFilter } from "@/components/ui/filter-pill";
import { NumberFilter } from "@/components/ui/number-filter";

/**
 * What counts as a win: a metric and its bar, as two pills. Changing the
 * metric drops the old bar, because a ROAS of 2 means nothing as a CPA.
 */

const PRESETS: Record<EvalMetric, number[]> = {
  roas: [1, 1.5, 2, 3, 4],
  cpa: [5, 10, 15, 20, 30],
  ctr: [0.5, 1, 1.5, 2],
  purchases: [1, 3, 5, 10],
};

const COMPARE: Record<EvalMetric, string> = {
  roas: "≥",
  cpa: "≤",
  ctr: "≥",
  purchases: "≥",
};

export function WinFilter({ metric, threshold }: { metric: EvalMetric; threshold: number }) {
  return (
    <>
      <QueryFilter
        name="metric"
        prefix="A win is"
        defaultValue="roas"
        resets={["threshold"]}
        options={[
          { value: "roas", label: "ROAS" },
          { value: "cpa", label: "CPA" },
          { value: "ctr", label: "CTR" },
          { value: "purchases", label: "Purchases" },
        ]}
      />
      <NumberFilter
        name="threshold"
        label={COMPARE[metric]}
        presets={PRESETS[metric]}
        defaultValue={threshold}
        step={0.1}
        format={(n) => (metric === "ctr" ? `${n}%` : metric === "roas" ? `${n}×` : String(n))}
      />
    </>
  );
}
