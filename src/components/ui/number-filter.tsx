"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { NumberInput } from "@astryxdesign/core/NumberInput";

import { FilterChoices, FilterPill, useFilterNavigate } from "@/components/ui/filter-pill";

/**
 * A numeric filter on one query key, as a pill: "Min spend ≥ $50 ▾".
 *
 * Presets apply on pick like any other pill. A typed value needs a moment to
 * be finished, so the free-entry box below them applies on Enter or Set.
 */
export function NumberFilter({
  name,
  label,
  presets,
  format = (n) => String(n),
  step = 1,
  allLabel,
  defaultValue,
}: {
  name: string;
  /** Prefix for the pill, e.g. "Min spend". */
  label: string;
  presets: number[];
  format?: (n: number) => string;
  step?: number;
  /** The "no filter" option. Omit when the key always has a value. */
  allLabel?: string;
  /** Shown when the key is absent and there is no "no filter" option. */
  defaultValue?: number;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const navigate = useFilterNavigate();
  const raw = params.get(name);
  const current = raw !== null && raw !== "" ? Number(raw) : defaultValue;
  const active = raw !== null && raw !== "" && (allLabel ? Number(raw) !== 0 : true);
  const [typed, setTyped] = useState<number | null>(current ?? null);

  const href = (value: number | null) => {
    const q = new URLSearchParams(params.toString());
    if (value === null) q.delete(name);
    else q.set(name, String(value));
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const apply = (value: number | null) => {
    if (value === null || Number.isNaN(value)) return;
    navigate(href(value));
  };

  const shown =
    current === undefined || Number.isNaN(current) || (allLabel && !active)
      ? (allLabel ?? label)
      : `${label} ${format(current)}`;

  // The radio value: "" for "no filter", the number for a preset, and nothing
  // checked when the URL holds a typed value that is not a preset.
  const value = !active ? (allLabel ? "" : String(current)) : String(current);

  return (
    <FilterPill
      label={shown}
      active={Boolean(active)}
      footer={
        <HStack gap={1.5} vAlign="end" padding={2}>
          <NumberInput
            label={label}
            isLabelHidden
            size="sm"
            value={typed}
            onChange={setTyped}
            onKeyDown={(e) => {
              if (e.key === "Enter") apply(Number(e.currentTarget.value));
            }}
            step={step}
            min={0}
            placeholder="Custom value"
            containerClassName="min-w-0 flex-1"
          />
          <Button label="Set" size="sm" className="shrink-0" onClick={() => apply(typed ?? Number.NaN)} />
        </HStack>
      }
    >
      <FilterChoices
        label={label}
        value={value}
        choices={[
          ...(allLabel ? [{ value: "", label: allLabel, href: href(null) }] : []),
          ...presets.map((p) => ({ value: String(p), label: format(p), href: href(p) })),
        ]}
      />
    </FilterPill>
  );
}
