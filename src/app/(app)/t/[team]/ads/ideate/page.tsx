import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { adDrafts, taskRuns, taskTemplates } from "@/db/schema";
import { EmptyState } from "@/components/empty-state";
import { AdsNotConnected } from "@/components/ads/not-connected";
import { adsPath, requireAdsTeam } from "@/lib/ads/access";
import { resolveMetaScope } from "@/lib/ads/scope";
import { loadDraftContext } from "@/lib/ads/drafts/load-context";
import { lintAdCopy } from "@/lib/ads/drafts/lint";
import { AdBriefTool } from "@/components/ads/ad-brief-tool";
import { getModelOptions } from "@/lib/models";
import { AdDraftCard, type AdDraftModel } from "@/components/ads/draft-card";
import { AdsToolbar } from "../toolbar";

/**
 * Where the next ad comes from.
 *
 * The brief writes a first draft out of what has already sold on this account,
 * then the specialist edits it, attaches the two ratios, and either uploads it
 * paused or copies it out for Ads Manager. It used to live under Tasks, which
 * put the one creative step of the job in a different part of the app from
 * everything else about the channel.
 */
export const maxDuration = 300;

function ymd(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

export default async function AdsIdeatePage({
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

  const one = (key: string) => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const show = one("show") || "open";

  // A brief is written for one account: it reads that account's own winners.
  const account = scope.selected.find((s) => s.brand.id === one("brand")) ?? scope.selected[0];

  const statuses =
    show === "uploaded"
      ? ["uploading", "uploaded"]
      : show === "archived"
        ? ["archived"]
        : ["requested", "ready_to_run", "failed_to_run"];

  const connectionIds = scope.selected.map((s) => s.connection.id);
  const byConnection = new Map(scope.selected.map((s) => [s.connection.id, s]));

  const [drafts, briefTemplate, context, modelOptions] = await Promise.all([
    connectionIds.length
      ? db
          .select()
          .from(adDrafts)
          .where(
            and(
              inArray(adDrafts.connectionId, connectionIds),
              inArray(adDrafts.status, statuses),
            ),
          )
          .orderBy(desc(adDrafts.requestedAt))
          .limit(100)
      : [],
    db.query.taskTemplates.findFirst({
      where: and(
        eq(taskTemplates.teamId, team.id),
        eq(taskTemplates.renderAs, "ad-brief"),
        eq(taskTemplates.isActive, true),
      ),
    }),
    account
      ? loadDraftContext({
          connectionId: account.connection.id,
          brandId: account.brand.id,
          brandName: account.brand.name,
          currency: account.currency,
          range: { start: ymd(30), end: ymd(1) },
          windowDays: 30,
        }).catch(() => null)
      : Promise.resolve(null),
    getModelOptions(),
  ]);

  const models: AdDraftModel[] = drafts.map((d) => {
    const acct = byConnection.get(d.connectionId);
    return {
      id: d.id,
      brandId: d.brandId,
      brandName: acct?.brand.name ?? "",
      brandSlug: acct?.brand.slug ?? "",
      adAccountId: acct?.adAccountId ?? "",
      writeOk: acct?.writeGate.ok ?? false,
      status: d.status,
      concept: d.concept,
      purpose: d.purpose,
      eventDate: d.eventDate,
      funnels: (d.funnels ?? []) as string[],
      headline: d.headline,
      primaryText: d.primaryText,
      description: d.description,
      callToAction: d.callToAction,
      linkUrl: d.linkUrl,
      targetAdSetId: d.targetAdSetId,
      notes: d.notes,
      assets: ((d.assets ?? []) as AdDraftModel["assets"]) ?? [],
      metaAdId: d.metaAdId,
      findings: lintAdCopy({
        headline: d.headline,
        primaryText: d.primaryText,
        description: d.description,
        purpose: d.purpose,
        eventDate: d.eventDate ?? undefined,
      }),
      requestedAt: d.requestedAt.toLocaleDateString("en-PH", {
        month: "short",
        day: "numeric",
      }),
    };
  });

  const pastBriefs = briefTemplate
    ? await db
        .select()
        .from(taskRuns)
        .where(
          and(
            eq(taskRuns.templateId, briefTemplate.id),
            inArray(
              taskRuns.brandId,
              scope.selected.map((s) => s.brand.id),
            ),
          ),
        )
        .orderBy(desc(taskRuns.createdAt))
        .limit(8)
    : [];

  const base = `${adsPath(team.slug)}/ideate`;
  const linkTo = (next: Record<string, string>) =>
    `${base}?${new URLSearchParams({ brands: scope.param, show, ...next })}`;

  return (
    <>
      <AdsToolbar scope={scope.raw} pathname={base} query={{ show }} showDates={false} />

      {briefTemplate && account ? (
        <section className="mb-6">
          <AdBriefTool
            teamSlug={team.slug}
            templateId={briefTemplate.id}
            fields={briefTemplate.inputFields}
            brands={scope.selected.map((s) => ({ id: s.brand.id, name: s.brand.name }))}
            models={modelOptions}
            templateModel={briefTemplate.model}
          />
        </section>
      ) : (
        <div className="mb-6 rounded-xl border border-dashed border-zinc-300 p-4 text-xs text-zinc-500">
          No ad brief template on this team yet. An admin adds one under Tasks with its
          output set to the ad brief.
        </div>
      )}

      <nav className="mb-3 flex flex-wrap gap-1.5">
        {[
          { key: "open", label: "Drafts" },
          { key: "uploaded", label: "Uploaded" },
          { key: "archived", label: "Archived" },
        ].map((t) => (
          <Link
            key={t.key}
            href={linkTo({ show: t.key })}
            className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
              t.key === show
                ? "bg-zinc-900 text-zinc-50"
                : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {models.length === 0 ? (
        <EmptyState
          title={`Nothing ${show === "open" ? "in drafts" : show}`}
          description="Write a brief above and the model drafts one from what has already sold on this account."
        />
      ) : (
        <div className="grid gap-3">
          {models.map((draft) => (
            <AdDraftCard
              key={draft.id}
              draft={draft}
              teamSlug={team.slug}
              adSets={context?.adSets ?? []}
            />
          ))}
        </div>
      )}

      {pastBriefs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
            Earlier briefs
          </h2>
          <ul className="flex flex-col gap-1.5">
            {pastBriefs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/t/${team.slug}/runs/${run.id}`}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
                >
                  <span className="min-w-0 truncate">
                    {String((run.inputs as Record<string, string>)?.goal ?? "Ad brief")}
                  </span>
                  <span className="grow" />
                  <span className="text-[0.65rem] text-zinc-400">
                    {run.createdAt.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
