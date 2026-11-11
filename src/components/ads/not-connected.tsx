import { Megaphone } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { EmptyState } from "@/components/empty-state";

/**
 * Every Ads surface with no Meta ad account to read. One component so they
 * all say the same thing and all offer the way out.
 */
export function AdsNotConnected({ description }: { description?: string }) {
  return (
    <EmptyState
      icon={<Megaphone className="size-4" />}
      title="No Meta ad account is connected yet"
      description={
        description ??
        "An admin connects one in Admin, Integrations. The system user also needs the ad account assigned to it, or the connection reads fine and can do nothing."
      }
      action={
        <Button href="/admin/integrations" label="Open integrations" variant="primary" />
      }
    />
  );
}
