"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { socialPostDrafts } from "@/db/schema";
import { requireSocialBrands, requireSocialDraft, socialPath } from "@/lib/social/access";
import {
  cancelMetaScheduled,
  publishNow,
  scheduleOnFacebook,
  verifyScheduled,
} from "@/lib/social/publisher";
import { organicConnectionId } from "@/lib/integrations/meta_organic/publish";
import { validateDraft as validateMetaDraft, type DraftShape, type TargetShape } from "@/lib/social/validate";
import { DEFAULT_TIKTOK_OPTIONS, validateTiktokDraft } from "@/lib/social/tiktok-rules";

/**
 * Save-time checks by channel. TikTok's verified-URL rule is left to publish
 * time, because a draft is routinely saved before its final media is attached.
 */
function validateDraft(d: DraftShape, target: TargetShape): string | null {
  if (d.channel === "tiktok") {
    if (d.mediaUrls.length === 0) return null;
    return validateTiktokDraft(
      { mediaType: d.mediaType, caption: d.caption, mediaUrls: d.mediaUrls, options: DEFAULT_TIKTOK_OPTIONS },
      null,
    );
  }
  return validateMetaDraft(d, target);
}
import { dayIn, wallClockToUtc } from "@/lib/social/time";
import { normalizeImageFromUrl, isOwnMediaUrl } from "@/lib/social/media";

/**
 * Everything a person can do to a draft.
 *
 * Server actions are reachable by direct POST, so nothing in the form is
 * trusted: the team is re-authorised, and a draft's brand is read off the row
 * rather than taken from a hidden field. A form naming a brand the user does
 * happen to hold would otherwise authorise editing a different brand's draft.
 */

export type SocialActionState = {
  error?: string;
  ok?: string;
  /** One line per brand when a compose fans out. */
  results?: { draftId: string; brandName: string; status: string; permalink?: string; error?: string }[];
};

const EMPTY: SocialActionState = {};

function refresh() {
  // One call covers every tab: they share a layout.
  revalidatePath(socialPath(), "layout");
}

function urls(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
}

function channelOf(raw: string): "instagram" | "facebook" | "both" | "tiktok" {
  // TikTok must survive an edit: falling through to "instagram" would quietly
  // retarget a TikTok draft at Meta.
  return raw === "facebook" || raw === "both" || raw === "tiktok" ? raw : "instagram";
}

/**
 * Create one draft per selected brand, and optionally publish or schedule it.
 *
 * The same post to three brands is three rows sharing a `groupId`, not one row
 * with three targets: each will get its own media id, its own numbers, and can
 * fail on its own.
 */
export async function createDrafts(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const brandIds = formData.getAll("brandIds").map(String).filter(Boolean);
  const intent = String(formData.get("intent") ?? "save");

  if (brandIds.length === 0) return { error: "Pick at least one brand." };

  const { user, brands } = await requireSocialBrands(teamSlug, brandIds);

  const channel = channelOf(String(formData.get("channel") ?? "instagram"));
  const mediaType = String(formData.get("mediaType") ?? "image");
  const caption = String(formData.get("caption") ?? "");
  const mediaUrls = urls(String(formData.get("mediaUrls") ?? ""));
  const linkUrl = String(formData.get("linkUrl") ?? "").trim() || null;
  const firstComment = String(formData.get("firstComment") ?? "");
  const altText = String(formData.get("altText") ?? "");
  const tags = urls(String(formData.get("tags") ?? "")).map((t) => t.replace(/^#/, ""));
  const plannedFor = String(formData.get("plannedFor") ?? "").trim() || null;
  const scheduleLocal = String(formData.get("scheduleAt") ?? "").trim();

  if (!caption.trim() && mediaUrls.length === 0) {
    return { error: "A post needs a caption or some media." };
  }

  const scheduleAt = scheduleLocal ? wallClockToUtc(scheduleLocal) : null;
  if (intent === "schedule" && !scheduleAt) {
    return { error: "That schedule time could not be read." };
  }
  if (intent === "schedule" && channel === "instagram") {
    return {
      error:
        "Instagram has no scheduling API. Publish it now, or plan a day and post it by hand.",
    };
  }

  const groupId = crypto.randomUUID();
  const results: NonNullable<SocialActionState["results"]> = [];

  for (const brand of brands) {
    // Instagram will not fetch a PNG, and the image studio writes PNGs, so
    // anything not already a JPEG is converted before it is stored on the row.
    let media = mediaUrls;
    if (channel !== "facebook") {
      const converted: string[] = [];
      for (const url of mediaUrls) {
        if (/\.(jpe?g)(\?|$)/i.test(url) || /\.(mp4|mov)(\?|$)/i.test(url)) {
          converted.push(url);
          continue;
        }
        if (!(await isOwnMediaUrl(url, brand.id))) {
          converted.push(url); // validation will reject it with a reason
          continue;
        }
        try {
          const jpeg = await normalizeImageFromUrl(url, brand.id);
          converted.push(jpeg.url);
        } catch {
          converted.push(url);
        }
      }
      media = converted;
    }

    const shape: DraftShape = {
      channel,
      mediaType,
      caption,
      mediaUrls: media,
      linkUrl,
      firstComment,
      scheduledAt: intent === "schedule" ? scheduleAt : null,
    };
    const invalid = validateDraft(shape, {
      igUserId: brand.connection?.igUserId ?? "",
    });
    if (invalid) {
      results.push({ draftId: "", brandName: brand.name, status: "invalid", error: invalid });
      continue;
    }

    // A scheduled cross-post splits: Facebook goes to Meta's clock, Instagram
    // becomes a plain draft planned for the same day, because there is nothing
    // that could publish it automatically.
    const splitting = intent === "schedule" && channel === "both" && scheduleAt;
    const rowChannel = splitting ? "facebook" : channel;

    const [row] = await db
      .insert(socialPostDrafts)
      .values({
        brandId: brand.id,
        connectionId: await organicConnectionId(brand.id),
        channel: rowChannel,
        mediaType,
        caption,
        mediaUrls: media,
        linkUrl,
        firstComment,
        altText,
        tags,
        plannedFor,
        groupId,
        createdById: user.id,
        agentDrafted: false,
        status: "draft",
      })
      .returning();

    if (splitting && scheduleAt) {
      await db.insert(socialPostDrafts).values({
        brandId: brand.id,
        connectionId: row.connectionId,
        channel: "instagram",
        mediaType,
        caption,
        mediaUrls: media,
        firstComment,
        altText,
        tags,
        // A day on the calendar, for a person to act on. Nothing publishes it.
        plannedFor: dayIn(scheduleAt),
        groupId,
        createdById: user.id,
        status: "draft",
      });
    }

    if (intent === "publish") {
      const result = await publishNow(row.id, user.id);
      results.push({
        draftId: row.id,
        brandName: brand.name,
        status: result.ok ? "published" : "failed",
        permalink: result.draft?.permalink ?? undefined,
        error: result.ok ? undefined : result.message,
      });
    } else if (intent === "schedule" && scheduleAt) {
      const result = await scheduleOnFacebook(row.id, user.id, scheduleAt);
      results.push({
        draftId: row.id,
        brandName: brand.name,
        status: result.ok ? "scheduled" : "failed",
        error: result.ok ? undefined : result.message,
      });
    } else {
      results.push({ draftId: row.id, brandName: brand.name, status: "draft" });
    }
  }

  refresh();

  const failed = results.filter((r) => r.error);
  const saved = results.filter((r) => !r.error);
  if (saved.length === 0) {
    return { error: failed[0]?.error ?? "Nothing was saved.", results };
  }
  const verb =
    intent === "publish" ? "Published" : intent === "schedule" ? "Scheduled" : "Saved";
  return {
    ok: `${verb} for ${saved.map((r) => r.brandName).join(", ")}.`,
    results,
  };
}

export async function updateDraft(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const { user, draft, brand } = await requireSocialDraft(teamSlug, draftId);

  if (!["draft", "failed"].includes(draft.status)) {
    return { error: "Only a draft or a failed post can be edited." };
  }

  const channel = channelOf(String(formData.get("channel") ?? draft.channel));
  const mediaUrls = urls(String(formData.get("mediaUrls") ?? draft.mediaUrls.join("\n")));
  const caption = String(formData.get("caption") ?? draft.caption);
  const mediaType = String(formData.get("mediaType") ?? draft.mediaType);
  const firstComment = String(formData.get("firstComment") ?? draft.firstComment);

  const invalid = validateDraft(
    { channel, mediaType, caption, mediaUrls, firstComment },
    { igUserId: brand.connection?.igUserId ?? "" },
  );
  if (invalid) return { error: invalid };

  // Changing the media invalidates any container held from a failed attempt.
  const mediaChanged = mediaUrls.join("\n") !== draft.mediaUrls.join("\n");

  await db
    .update(socialPostDrafts)
    .set({
      channel,
      mediaType,
      caption,
      mediaUrls,
      firstComment,
      altText: String(formData.get("altText") ?? draft.altText),
      linkUrl: String(formData.get("linkUrl") ?? draft.linkUrl ?? "").trim() || null,
      plannedFor: String(formData.get("plannedFor") ?? "").trim() || null,
      lastEditedById: user.id,
      ...(mediaChanged
        ? { igContainerId: null, igContainerChildren: [], ttPublishId: null }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(socialPostDrafts.id, draftId));

  refresh();
  return { ok: "Saved." };
}

/** Publish now. Also the Retry and Finish publishing path. */
export async function publishDraftNow(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const { user } = await requireSocialDraft(teamSlug, draftId);

  const result = await publishNow(draftId, user.id);
  refresh();
  return result.ok ? { ok: result.message } : { error: result.message };
}

export async function scheduleDraftOnFacebook(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const { user, draft } = await requireSocialDraft(teamSlug, draftId);

  const at = wallClockToUtc(String(formData.get("scheduleAt") ?? ""), draft.timezone);
  if (!at) return { error: "That schedule time could not be read." };

  const result = await scheduleOnFacebook(draftId, user.id, at);
  refresh();
  return result.ok ? { ok: result.message } : { error: result.message };
}

export async function cancelFacebookSchedule(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  await requireSocialDraft(teamSlug, draftId);

  const result = await cancelMetaScheduled(draftId);
  refresh();
  return result.ok ? { ok: result.message } : { error: result.message };
}

export async function verifyWithMeta(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  await requireSocialDraft(teamSlug, draftId);

  const result = await verifyScheduled(draftId);
  refresh();
  return result.ok ? { ok: result.message } : { error: result.message };
}

/**
 * Discard. Soft, deliberately: the hard DELETE this replaces threw away the
 * record that someone had decided not to post something.
 */
export async function discardDraft(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const { draft } = await requireSocialDraft(teamSlug, draftId);

  if (draft.status === "published") return { error: "A published post cannot be discarded." };
  if (draft.status === "scheduled") {
    return { error: "Facebook is holding this one. Cancel the schedule first." };
  }
  if (draft.status === "publishing") {
    return { error: "This is being published right now." };
  }

  await db
    .update(socialPostDrafts)
    .set({ status: "discarded", discardedAt: new Date(), updatedAt: new Date() })
    .where(eq(socialPostDrafts.id, draftId));

  refresh();
  return { ok: "Discarded." };
}

export async function restoreDraft(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const { draft } = await requireSocialDraft(teamSlug, draftId);
  if (draft.status !== "discarded") return { error: "That draft is not discarded." };

  await db
    .update(socialPostDrafts)
    .set({ status: "draft", discardedAt: null, error: null, updatedAt: new Date() })
    .where(eq(socialPostDrafts.id, draftId));

  refresh();
  return { ok: "Back in drafts." };
}

/** Put a draft on a day, or take it off one. */
export async function setPlannedFor(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const draftId = String(formData.get("draftId") ?? "");
  const { user, draft } = await requireSocialDraft(teamSlug, draftId);
  if (!["draft", "failed"].includes(draft.status)) {
    return { error: "Only a draft can be planned." };
  }

  const day = String(formData.get("plannedFor") ?? "").trim();
  await db
    .update(socialPostDrafts)
    .set({
      plannedFor: day || null,
      lastEditedById: user.id,
      updatedAt: new Date(),
    })
    .where(eq(socialPostDrafts.id, draftId));

  refresh();
  return { ok: day ? `Planned for ${day}.` : "Taken off the calendar." };
}

/** Bulk discard, for clearing out a stale queue. */
export async function discardMany(
  _prev: SocialActionState,
  formData: FormData,
): Promise<SocialActionState> {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const ids = formData.getAll("draftIds").map(String).filter(Boolean);
  if (ids.length === 0) return { error: "Nothing was selected." };

  // Each row is authorised on its own; a list is not a way around the check.
  const allowed: string[] = [];
  for (const id of ids) {
    const { draft } = await requireSocialDraft(teamSlug, id);
    if (["draft", "failed"].includes(draft.status)) allowed.push(draft.id);
  }
  if (allowed.length === 0) return { error: "None of those can be discarded." };

  await db
    .update(socialPostDrafts)
    .set({ status: "discarded", discardedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(socialPostDrafts.id, allowed)));

  refresh();
  return { ok: `Discarded ${allowed.length}.` };
}

export { EMPTY as SOCIAL_ACTION_INITIAL };
