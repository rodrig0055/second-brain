import type { ComponentProps } from "react";

import { FilterBar } from "@/components/filter-bar";

/** Accounts, the page's own filters, then the window. Ads offers 14 days too. */
export function AdsToolbar({
  presets = ["7d", "14d", "28d", "30d", "90d"],
  ...rest
}: ComponentProps<typeof FilterBar>) {
  return <FilterBar presets={presets} {...rest} />;
}
