"use client";

import { useState } from "react";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { GoogleAdsDashboards } from "@/components/google-ads/dashboards-client";
import {
  StorefrontDashboards,
  type StorefrontBrand,
} from "@/components/storefront/dashboards-client";

type GoogleAccount = {
  id: string;
  label: string;
  brand: string;
  customerId: string;
  currency: string;
  status: string;
};
type Platform = "google_ads" | "meta" | "storefront" | "newsletter";

export function DashboardsSwitcher({
  googleAccounts,
  storefrontBrands,
  newsletter,
}: {
  googleAccounts: GoogleAccount[];
  storefrontBrands: StorefrontBrand[];
  /**
   * Server-rendered newsletter results. Passed as a node rather than fetched
   * here: the data comes from Neon, and an API route just to feed a tab would
   * be a second read path for the same rows.
   */
  newsletter?: React.ReactNode;
}) {
  const tabs: { id: Platform; label: string }[] = [];
  if (newsletter) tabs.push({ id: "newsletter", label: "Newsletter" });
  if (googleAccounts.length) tabs.push({ id: "google_ads", label: "Google Ads" });
  // Meta creative moved into the Meta Ads workspace, where the brand chips and
  // the date window drive it like they drive everything else on that channel.
  if (storefrontBrands.length) tabs.push({ id: "storefront", label: "Storefront" });

  const [platform, setPlatform] = useState<Platform>(tabs[0]?.id ?? "storefront");

  return (
    <div>
      {tabs.length > 1 && (
        <div className="mb-5">
          <SegmentedControl
            label="Platform"
            value={platform}
            onChange={(v) => setPlatform(v as Platform)}
          >
            {tabs.map((t) => (
              <SegmentedControlItem key={t.id} value={t.id} label={t.label} />
            ))}
          </SegmentedControl>
        </div>
      )}

      {platform === "newsletter" && newsletter}
      {platform === "google_ads" && googleAccounts.length > 0 && (
        <GoogleAdsDashboards accounts={googleAccounts} />
      )}
      {platform === "storefront" && storefrontBrands.length > 0 && (
        <StorefrontDashboards brands={storefrontBrands} />
      )}
    </div>
  );
}
