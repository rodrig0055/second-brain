import "server-only";

import { requireSocialTeam } from "@/lib/social/access";
import { loadPickerMedia } from "@/lib/social/media";
import { loadPostsTable } from "@/lib/social/metrics";
import { loadDraft } from "@/lib/social/drafts";
import type { ComposeBrand, ComposeForm } from "./compose-form";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Everything the composer needs, for the full page and the side panel alike,
 * so the two can never disagree about what a link like ?draft= prefills.
 * Null when the person has no connected brand to post for.
 */
export async function loadCompose(teamSlug: string, sp: SearchParams) {
  const { team, brands } = await requireSocialTeam(teamSlug);
  if (brands.length === 0) return null;

  const one = (key: string) => {
    const v = sp[key];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };

  const wantedBrand = brands.find((b) => b.id === one("brand")) ?? brands[0];

  // Prefill, either from an existing draft or from a post being varied.
  let initial: Parameters<typeof ComposeForm>[0]["initial"];
  const draftId = one("draft");
  const from = one("from");

  if (draftId) {
    const draft = await loadDraft(draftId);
    if (draft && brands.some((b) => b.id === draft.brandId)) {
      initial = {
        brandIds: [draft.brandId],
        caption: draft.caption,
        mediaUrls: draft.mediaUrls,
        channel: draft.channel,
        mediaType: draft.mediaType,
        plannedFor: draft.plannedFor ?? undefined,
      };
    }
  } else if (from) {
    const [post] = await loadPostsTable({
      brandIds: brands.map((b) => b.id),
      startDate: "2000-01-01",
      endDate: "2100-01-01",
      limit: 2000,
    }).then((rows) => rows.filter((r) => r.dimensionKey === from));
    if (post) {
      initial = {
        brandIds: [post.brandId],
        caption: post.caption,
        channel: post.channel === "facebook" ? "facebook" : "instagram",
      };
    }
  }

  if (!initial) initial = { brandIds: [wantedBrand.id], plannedFor: one("plannedFor") || undefined };

  const picker = await loadPickerMedia(initial.brandIds?.[0] ?? wantedBrand.id);

  const model: ComposeBrand[] = brands.map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    igUserId: b.connection?.igUserId ?? "",
    connectionStatus: b.connection?.status ?? "",
  }));

  return { teamSlug: team.slug, brands: model, picker, initial };
}
