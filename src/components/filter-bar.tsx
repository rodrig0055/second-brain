import { Suspense, type ReactNode } from "react";
import { HStack } from "@astryxdesign/core/HStack";

import { BrandFilter, type ScopeBadge } from "@/components/brand-filter";
import { DateFilter } from "@/components/date-filter";
import type { BrandScope } from "@/lib/brand-scope";
import type { DatePresetKey, ResolvedDateRange } from "@/lib/date-range";

/**
 * The filter row of a channel workspace: brands, then the page's own filters,
 * then the window, with view controls on the right. One component so Social,
 * Ads and whatever comes next put their filters in the same place.
 *
 * Rendered per page rather than in a layout: a layout gets no searchParams, so
 * one there would show a stale window the moment someone changed it.
 */
export function FilterBar({
  scope,
  pathname,
  query = {},
  range,
  presets,
  badges,
  showDates = true,
  children,
  right,
}: {
  scope: BrandScope;
  /** This page's own path, for the brand scope action to return to. */
  pathname: string;
  /** Params the brand scope should keep when it changes. */
  query?: Record<string, string>;
  range?: ResolvedDateRange;
  presets?: DatePresetKey[];
  badges?: Record<string, ScopeBadge[]>;
  showDates?: boolean;
  /** Extra filter pills for this page. */
  children?: ReactNode;
  /** Right-aligned: search, view switches, export. */
  right?: ReactNode;
}) {
  return (
    <HStack gap={2} wrap="wrap" vAlign="center" hAlign="between" className="mb-4">
      <HStack gap={2} wrap="wrap" vAlign="center">
        <BrandFilter scope={scope} pathname={pathname} query={query} badges={badges} />
        <Suspense fallback={null}>
          {children}
          {showDates && range && <DateFilter range={range} presets={presets} />}
        </Suspense>
      </HStack>
      {right && (
        <HStack gap={2} wrap="wrap" vAlign="center">
          {right}
        </HStack>
      )}
    </HStack>
  );
}
