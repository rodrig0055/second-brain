"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { DropdownMenuCheckboxItem, DropdownMenuDivider } from "@astryxdesign/core/DropdownMenu";
import { DateRangeInput } from "@astryxdesign/core/DateRangeInput";
import type { ISODateString } from "@astryxdesign/core/Calendar";

import {
  DATE_PRESETS,
  DATE_RANGE_KEYS,
  presetLabel,
  todayIn,
  type DatePresetKey,
  type ResolvedDateRange,
} from "@/lib/date-range";
import { FilterChoices, FilterPill, useFilterNavigate } from "@/components/ui/filter-pill";

/**
 * The date window as a filter pill: "Last 28 days ▾", with the presets and the
 * compare switch as menu rows and a custom range below them.
 *
 * Every part applies on pick: a preset or the compare switch at once, a custom
 * range as soon as both ends are chosen.
 */
export function DateFilter({
  range,
  presets,
  showCompare = true,
}: {
  range: ResolvedDateRange;
  presets?: DatePresetKey[];
  showCompare?: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const navigate = useFilterNavigate();
  const shown = presets ? DATE_PRESETS.filter((p) => presets.includes(p.key)) : DATE_PRESETS;

  function href(next: Record<string, string>) {
    const q = new URLSearchParams(params.toString());
    for (const key of DATE_RANGE_KEYS) q.delete(key);
    q.delete("days");
    for (const [k, v] of Object.entries(next)) q.set(k, v);
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const current: Record<string, string> =
    range.preset === "custom" ? { from: range.start, to: range.end } : { range: range.preset };
  const carry: Record<string, string> = range.compare ? { compare: "1" } : {};

  const label = range.preset === "custom" ? range.label : presetLabel(range.preset);

  return (
    <FilterPill
      label={range.compare ? `${label} · compared` : label}
      icon={<CalendarRange className="size-3.5 text-secondary" aria-hidden />}
      width={256}
      footer={
        <VStack gap={1} padding={2}>
          <Text type="supporting" color="secondary">
            Custom range
          </Text>
          <DateRangeInput
            label="Custom range"
            isLabelHidden
            size="sm"
            hasClear={false}
            value={{ start: range.start as ISODateString, end: range.end as ISODateString }}
            max={todayIn() as ISODateString}
            onChange={(next) => {
              if (next) navigate(href({ from: next.start, to: next.end, ...carry }));
            }}
            width="100%"
          />
        </VStack>
      }
    >
      <FilterChoices
        label="Date range"
        value={range.preset === "custom" ? undefined : range.preset}
        choices={shown.map((preset) => ({
          value: preset.key,
          label: presetLabel(preset.key),
          href: href({ range: preset.key, ...carry }),
        }))}
      />
      {showCompare && <DropdownMenuDivider />}
      {showCompare && (
        <DropdownMenuCheckboxItem
          label="Compare to previous period"
          description={range.compare ? range.compareLabel : undefined}
          value={range.compare}
          hasCloseOnSelect
          onChange={(on) => navigate(href(on ? { ...current, compare: "1" } : current))}
        />
      )}
    </FilterPill>
  );
}
