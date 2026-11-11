import Link from "next/link";
import { PenSquare, PlugZap } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { EmptyState } from "@/components/empty-state";
import { requireSocialTeam, socialPath } from "@/lib/social/access";
import { resolveBrandScope } from "@/lib/brand-scope";
import { draftCounts, listDrafts, pendingByBrand, type DraftStatus } from "@/lib/social/drafts";
import { SocialToolbar } from "../toolbar";
import { DraftCard, type DraftCardModel } from "./draft-card";
import { AutoRefresh } from "./auto-refresh";

/**
 * Everything that has not gone out yet, plus what went wrong.
 *
 * The old surface called this "needs review" and capped it at a hundred rows
 * with no way to see the hundred and first. The specialist writes these and
 * publishes them; there is no second approver, so the framing is drafts.
 */

const TABS: { key: string; label: string; statuses: DraftStatus[] }[] = [
  { key: "open", label: "Open", statuses: ["draft", "failed", "publishing"] },
  { key: "draft", label: "Drafts", statuses: ["draft"] },
  { key: "scheduled", label: "On Facebook", statuses: ["scheduled"] },
  { key: "failed", label: "Failed", statuses: ["failed"] },
  { key: "publishing", label: "Publishing", statuses: ["publishing"] },
  { key: "published", label: "Published", statuses: ["published"] },
  { key: "discarded", label: "Discarded", statuses: ["discarded"] },
];

function stamp(d: Date | null): string | null {
  if (!d) return null;
  return d.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function SocialDraftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { team: teamSlug } = await params;
  const sp = await searchParams;
  const { user, team, brands } = await requireSocialTeam(teamSlug);

  if (brands.length === 0) {
    return (
      <EmptyState
        icon={<PlugZap className="size-4" />}
        title="No connected social account"
        description="An admin connects a Meta Page under Admin, Integrations."
        action={<Button label="Go to Connections" variant="primary" href={socialPath("connections")} />}
      />
    );
  }

  const scope = await resolveBrandScope({ user, teamSlug: team.slug, searchParams: sp });
  const selectedIds = scope.selected.map((b) => b.id);

  const statusParam = typeof sp.status === "string" ? sp.status : "open";
  const active = TABS.find((t) => t.key === statusParam) ?? TABS[0];
  const page = Number(typeof sp.page === "string" ? sp.page : "1") || 1;
  const limit = 50;

  const [{ rows, total }, counts, pending] = await Promise.all([
    listDrafts({
      brandIds: selectedIds,
      statuses: active.statuses,
      limit,
      offset: (page - 1) * limit,
    }),
    draftCounts(selectedIds),
    pendingByBrand(scope.all.map((b) => b.id)),
  ]);

  const models: DraftCardModel[] = rows.map((r) => ({
    id: r.id,
    brandId: r.brandId,
    brandName: r.brandName,
    brandSlug: r.brandSlug,
    status: r.status,
    channel: r.channel,
    mediaType: r.mediaType,
    caption: r.caption,
    mediaUrls: r.mediaUrls,
    linkUrl: r.linkUrl,
    firstComment: r.firstComment,
    altText: r.altText,
    rationale: r.rationale,
    agentDrafted: r.agentDrafted,
    authorName: r.authorName,
    publisherName: r.publisherName,
    permalink: r.permalink,
    error: r.error,
    igMediaId: r.igMediaId,
    fbPostId: r.fbPostId,
    igContainerId: r.igContainerId,
    plannedFor: r.plannedFor,
    scheduledAtLabel: stamp(r.scheduledAt),
    publishAttempts: r.publishAttempts,
    isStalled: r.isStalled,
    createdAt: stamp(r.createdAt) ?? "",
    publishedAt: stamp(r.publishedAt),
  }));

  const anyPublishing = models.some((m) => m.status === "publishing" && !m.isStalled);
  const pages = Math.ceil(total / limit);
  const linkFor = (next: Record<string, string>) => {
    const q = new URLSearchParams({ brands: scope.param, status: active.key, ...next });
    return `${socialPath("drafts")}?${q.toString()}`;
  };

  return (
    <>
      <SocialToolbar
        scope={scope}
        pathname={socialPath("drafts")}
        query={{ status: active.key }}
        showDates={false}
        badges={Object.fromEntries(
          scope.all.map((b) => [
            b.slug,
            pending[b.id] ? [{ label: String(pending[b.id]), tone: "warn" as const }] : [],
          ]),
        )}
      />

      <nav className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((tab) => {
          const n = tab.statuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
          const on = tab.key === active.key;
          return (
            <Link
              key={tab.key}
              href={linkFor({ status: tab.key })}
              className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${
                on
                  ? "bg-zinc-900 text-zinc-50"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
              }`}
            >
              {tab.label}
              {n > 0 && <span className="ml-1.5 tabular-nums opacity-70">{n}</span>}
            </Link>
          );
        })}
      </nav>

      {models.length === 0 ? (
        <EmptyState
          icon={<PenSquare className="size-4" />}
          title={`Nothing ${active.label.toLowerCase()}`}
          description="Compose a post, or ask the agent in chat to draft one for a brand."
          action={
            <Button
              label="Compose a post"
              variant="primary"
              size="sm"
              href={socialPath("compose")}
            />
          }
        />
      ) : (
        <ul className="grid gap-3">
          {models.map((draft) => (
            <DraftCard key={draft.id} draft={draft} teamSlug={team.slug} />
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-xs text-zinc-500">
          <span className="tabular-nums">
            {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
          </span>
          <span className="flex gap-2">
            {page > 1 && (
              <Link href={linkFor({ page: String(page - 1) })} className="hover:text-zinc-800">
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={linkFor({ page: String(page + 1) })} className="hover:text-zinc-800">
                Next
              </Link>
            )}
          </span>
        </nav>
      )}

      {anyPublishing && <AutoRefresh />}
    </>
  );
}
