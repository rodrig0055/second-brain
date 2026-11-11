import { PlugZap } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { EmptyState } from "@/components/empty-state";
import { ComposeForm } from "./compose-form";
import { loadCompose } from "./load";

/**
 * The composer as a page of its own: what a shared link, a refresh, or a link
 * from outside Social opens. From inside Social the same URL opens in the side
 * panel instead (see ../@sheet/(.)compose).
 *
 * Publishing runs inside the action, and an Instagram video can hold Meta's
 * container open for two minutes, so this page needs the long budget.
 */
export const maxDuration = 300;

export default async function SocialComposePage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team } = await params;
  const data = await loadCompose(team, await searchParams);

  if (!data) {
    return (
      <EmptyState
        icon={<PlugZap className="size-4" />}
        title="Connect an account to start posting"
        description="None of your brands has a social account connected yet."
        action={
          <Button
            label="Go to Connections"
            variant="primary"
            href={`/t/${team}/social/connections`}
          />
        }
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-card">
      <ComposeForm {...data} />
    </div>
  );
}
