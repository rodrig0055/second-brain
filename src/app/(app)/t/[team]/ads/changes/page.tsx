import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@/components/empty-state";
import { AdsNotConnected } from "@/components/ads/not-connected";
import { ChangeSetCard } from "@/components/ads/change-set-card";
import { adsPath, requireAdsTeam } from "@/lib/ads/access";
import { loadChangeSets } from "@/lib/ads/change-sets/load";
import { resolveMetaScope } from "@/lib/ads/scope";
import { AdsToolbar } from "../toolbar";

/**
 * Changes waiting on a decision.
 *
 * The inbox half of propose-only. Nothing in this app reaches a live ad
 * account without a person reading a card here and pressing a button, so this
 * page is the whole of the safety model made visible: what changes, what it
 * was, what it does to spend, and who said yes.
 *
 * Decided sets stay, below the pending ones. The record of what was approved
 * and why is the part anybody asks for afterwards, and a queue that empties
 * itself answers none of those questions.
 */
export default async function AdsChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team: teamSlug } = await params;
  const sp = await searchParams;
  const { user, team } = await requireAdsTeam(teamSlug);
  const scope = await resolveMetaScope(user, sp);

  if (scope.all.length === 0) {
    return (
      <AdsNotConnected />
    );
  }

  const brandIds = scope.selected.map((s) => s.brand.id);
  const sets = await loadChangeSets({ brandIds, limit: 40 });
  // "approved" means approved and then blocked before anything ran, so it is
  // still waiting on somebody rather than settled. Filing it under Decided
  // would hide a set that never happened behind a word saying it did.
  const pending = sets.filter((s) => s.state === "pending" || s.state === "approved");
  const decided = sets.filter((s) => s.state !== "pending" && s.state !== "approved");

  // A brand whose writes are switched off can still collect proposals, and
  // saying so here is better than an approve button that refuses on press.
  const blocked = scope.selected.filter((s) => !s.writeGate.ok);

  return (
    <>
      <AdsToolbar
        scope={scope.raw}
        pathname={`${adsPath(team.slug)}/changes`}
        query={{}}
        showDates={false}
      />

      <div className="max-w-4xl space-y-4">

        {blocked.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-medium text-amber-900">
              Writes are off for {blocked.map((b) => b.brand.name).join(", ")}
            </p>
            <p className="mt-0.5 text-xs text-amber-800">{blocked[0].writeGate.reason}</p>
          </div>
        )}

        {pending.length === 0 && decided.length === 0 ? (
          <EmptyState
            title="Nothing waiting"
            description="Proposals from the rules and from the brain arrive here. Until then the account is only ever read."
            action={
              <Button href={`${adsPath(team.slug)}/alerts`} label="See the rules" />
            }
          />
        ) : (
          <>
            {pending.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Waiting on you ({pending.length})
                </h2>
                {pending.map((set) => (
                  <ChangeSetCard key={set.id} set={set} teamSlug={team.slug} />
                ))}
              </section>
            )}

            {decided.length > 0 && (
              <section className="space-y-3">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Decided
                </h2>
                {decided.map((set) => (
                  <ChangeSetCard key={set.id} set={set} teamSlug={team.slug} />
                ))}
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
