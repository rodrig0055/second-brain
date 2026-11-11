import { PlugZap } from "lucide-react";
import { requireSocialTeam, socialPath } from "@/lib/social/access";
import { resolveBrandScope } from "@/lib/brand-scope";
import { dateRangeParams, parseDateRange } from "@/lib/date-range";
import { loadPostsTable } from "@/lib/social/metrics";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@/components/empty-state";
import { SocialToolbar } from "../toolbar";
import { PostsTable } from "./posts-table";
import { PostFilterPills } from "./filters";

/**
 * Every post that went out, filterable.
 *
 * Posts published outside the app are here too: the sync writes them either
 * way, and a table that only showed our own would be a worse answer to "how did
 * last week go".
 */
export default async function SocialPostsPage({
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
  const range = parseDateRange(sp, { defaultPreset: "90d", endsYesterday: true });

  const one = (key: string) => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const channel = one("channel") === "instagram" || one("channel") === "facebook"
    ? (one("channel") as "instagram" | "facebook")
    : undefined;
  const mediaType = one("mediaType") || undefined;
  const search = one("q") || undefined;

  const rows = await loadPostsTable({
    brandIds: scope.selected.map((b) => b.id),
    startDate: range.start,
    endDate: range.end,
    channel,
    mediaType,
    search,
  });

  const query = {
    ...dateRangeParams(range),
    ...(channel ? { channel } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(search ? { q: search } : {}),
  };

  return (
    <>
      <SocialToolbar
        scope={scope}
        pathname={socialPath("posts")}
        query={query}
        range={range}
        presets={["7d", "28d", "30d", "90d"]}
      >
        <PostFilterPills />
      </SocialToolbar>

      <PostsTable rows={rows} multiBrand={scope.selected.length > 1} />
    </>
  );
}
