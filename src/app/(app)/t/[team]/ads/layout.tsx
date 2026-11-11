import { requireAdsTeam } from "@/lib/ads/access";
import { MessageSquare } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { RouteHeader } from "@/components/route-header";
import { adsPath } from "@/lib/ads/access";

/**
 * The Meta Ads workspace shell.
 *
 * Its pages are in the sidebar (the workspace drills down); this draws the
 * page header from the URL. Each page re-asserts the gate for itself: a layout
 * is a convenience, not a control.
 *
 * The budget is generous because an ad-level window over a big account is the
 * heaviest read in the app, and a server action on these pages inherits it.
 */
export const maxDuration = 120;

export default async function AdsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ team: string }>;
}) {
  const { team: teamSlug } = await params;
  const { team } = await requireAdsTeam(teamSlug);

  const base = adsPath(team.slug);

  return (
    <div className="mx-auto max-w-[90rem] px-4 py-5 sm:px-6 lg:px-8">
      <RouteHeader
        entries={[
          { href: base, title: "Overview", description: "Spend, results and what needs a decision, per account." },
          { href: `${base}/performance`, title: "Performance", description: "Every campaign, ad set and ad, sortable." },
          { href: `${base}/creatives`, title: "Creatives", description: "Which creative is working, by format and angle." },
          { href: `${base}/ideate`, title: "Ideate", description: "Ad drafts to review, built from what already works." },
          { href: `${base}/alerts`, title: "Alerts", description: "Rules that watch the accounts, and what they caught." },
          { href: `${base}/changes`, title: "Changes", description: "Nothing reaches a live account until somebody here says so." },
        ]}
        action={
          <Button
            href={`/chat?team=${team.slug}`}
            label="Ask the agent"
            icon={<MessageSquare className="size-4" />}
          />
        }
      />
      {children}
    </div>
  );
}
