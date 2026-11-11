"use client";

import { QueryFilter } from "@/components/ui/filter-pill";
import { NumberFilter } from "@/components/ui/number-filter";

/**
 * Funnel, status, objective and a spend floor, as pills that apply on pick and
 * live in the URL, so a view can be sent to a colleague.
 */
export function PerformanceFilters({
  statuses,
  objectives,
}: {
  statuses: string[];
  objectives: string[];
}) {
  return (
    <>
      <QueryFilter
        name="funnel"
        allLabel="All funnels"
        options={[
          { value: "TOF", label: "TOF" },
          { value: "MOF", label: "MOF" },
          { value: "BOF", label: "BOF" },
          { value: "unmapped", label: "Unmapped" },
          { value: "review", label: "Guessed from the name" },
        ]}
      />
      {statuses.length > 0 && (
        <QueryFilter
          name="status"
          allLabel="Any status"
          options={statuses.map((s) => ({ value: s, label: titleCase(s) }))}
        />
      )}
      {objectives.length > 0 && (
        <QueryFilter
          name="objective"
          allLabel="Any objective"
          options={objectives.map((o) => ({ value: o, label: titleCase(o.replace(/^OUTCOME_/, "")) }))}
        />
      )}
      <NumberFilter
        name="minSpend"
        label="Spend"
        allLabel="Any spend"
        presets={[10, 50, 100, 500, 1000]}
        step={10}
        format={(n) => `≥ ${n.toLocaleString("en-PH")}`}
      />
    </>
  );
}

/** ACTIVE -> Active, LINK_CLICKS -> Link clicks. */
function titleCase(s: string): string {
  const t = s.replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
