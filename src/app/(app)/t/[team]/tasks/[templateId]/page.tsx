import Link from "next/link";
import { AdsNotConnected } from "@/components/ads/not-connected";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections, taskTemplates } from "@/db/schema";
import { getUserBrands, requireTeam } from "@/lib/access";
import { isAdsTeam } from "@/lib/ads/access";
import { getModelOptions } from "@/lib/models";
import { AdBriefTool } from "@/components/ads/ad-brief-tool";
import { TaskRunner } from "@/components/task-runner";

export default async function TaskRunPage({
  params,
}: {
  params: Promise<{ team: string; templateId: string }>;
}) {
  const { team: teamSlug, templateId } = await params;
  const { user, team } = await requireTeam(teamSlug);

  const [template, brands, models] = await Promise.all([
    db.query.taskTemplates.findFirst({
      where: eq(taskTemplates.id, templateId),
    }),
    getUserBrands(user),
    getModelOptions(),
  ]);
  if (!template || template.teamId !== team.id || !template.isActive) {
    notFound();
  }

  const header = (
    <>
      <Link href={`/t/${team.slug}/tasks`} className="text-sm text-zinc-500 hover:text-zinc-700">
        ← All tasks
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900">{template.name}</h1>
      {template.description && <p className="mt-1 text-sm text-zinc-600">{template.description}</p>}
    </>
  );

  // renderAs === "ad-brief": the output is a set of ad drafts, not prose, so
  // the body is the brief tool instead of <TaskRunner>. Same template row, same
  // admin-editable prompt and model; what differs is that the result is saved
  // into the ad pipeline rather than read. Gated on the ads team, because the
  // tool writes into that team's queue and reads a brand's spend.
  if (template.renderAs === "ad-brief") {
    if (!isAdsTeam(team.slug)) notFound();

    const connections = brands.length
      ? await db.query.integrationConnections.findMany({
          where: and(
            eq(integrationConnections.platform, "meta"),
            inArray(
              integrationConnections.brandId,
              brands.map((b) => b.id),
            ),
          ),
        })
      : [];
    const connected = connections.filter((c) => c.status !== "disconnected");
    const briefBrands = brands.filter((b) =>
      connected.some((c) => c.brandId === b.id),
    );

    return (
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        {header}
        <div className="mt-7">
          {briefBrands.length === 0 ? (
            <AdsNotConnected description="The brief writes from an account's own results, so it needs one connected. An admin connects it in Admin, Integrations." />
          ) : (
            <AdBriefTool
              teamSlug={team.slug}
              templateId={template.id}
              fields={template.inputFields}
              brands={briefBrands.map((b) => ({ id: b.id, name: b.name }))}
              models={models}
              templateModel={template.model}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      {header}
      <div className="mt-7">
        <TaskRunner
          teamSlug={team.slug}
          templateId={template.id}
          fields={template.inputFields}
          brands={brands}
          models={models}
          templateModel={template.model}
          renderAs={template.renderAs}
        />
      </div>
    </div>
  );
}
