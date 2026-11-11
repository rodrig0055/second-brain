"use client";

import { CreativeDashboardBody } from "@/components/meta/charts";
import type { CreativeDashboardResult } from "@/lib/integrations/meta/creative-dashboard-types";

/**
 * Win rate, kill or scale, and iteration ideas.
 *
 * The charts themselves are unchanged; what changed is where their rows come
 * from. They used to fetch per account through an API route driven by a
 * dropdown; now the page loads them for whatever accounts are in scope, so the
 * brand chips at the top drive these the same way they drive everything else.
 */
export function CreativeViews({
  result,
  connectionId,
}: {
  result: CreativeDashboardResult;
  teamSlug?: string;
  connectionId?: string;
}) {
  return <CreativeDashboardBody data={result} connectionId={connectionId ?? ""} />;
}
