/**
 * Creating an ad on Meta from an approved draft.
 *
 * Three calls, in order, each depending on the last: upload the media, build a
 * creative that points at it, then make an ad in an existing ad set. Nothing
 * here creates an ad set or a campaign, and nothing sets a budget.
 *
 * Every ad is created PAUSED. A person turns it on. That is the whole safety
 * model for creation: the worst outcome of a bug here is a paused ad nobody
 * wanted, which costs nothing and is deleted in one click.
 */
import "server-only";

import {
  UPLOAD_TIMEOUT_MS,
  fetchBounded,
  readBoundedBytes,
} from "@/lib/integrations/http";
import {
  MetaApiError,
  graphPost,
  type MetaTarget,
} from "@/lib/integrations/meta/client";
import {
  checkCreateStatus,
  checkFields,
  type WriteResource,
} from "./allowlist";

/** An ad image, generously. Anything larger is not a creative, it is a mistake. */
const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** The two shapes every ad needs, per the process doc. */
export type DraftAsset = {
  ratio: "1:1" | "9:16";
  url: string;
  kind: "image" | "video";
  /** Filled in once uploaded, so a retry does not upload twice. */
  metaHash?: string;
  metaVideoId?: string;
};

export type CreateAdInput = {
  adSetId: string;
  name: string;
  headline: string;
  primaryText: string;
  description?: string;
  callToAction: string;
  linkUrl: string;
  pageId: string;
  instagramUserId?: string;
  assets: DraftAsset[];
  /**
   * Short tag of the draft this came from, carried into the creative's name
   * for the same reason the ad's name carries it: if a request dies after Meta
   * accepted it, the thing it made has to be findable by a person.
   */
  draftTag?: string;
};

/** Labels tying an asset to the placements it should appear in. */
const FEED_LABEL = "square_feed";
const STORY_LABEL = "vertical_story";

/**
 * Upload one image and return its hash.
 *
 * Sent as base64 `bytes` rather than a multipart file, because the image
 * already lives at a URL in our own storage and this avoids streaming it
 * through a multipart encoder just to hand Meta the same bytes.
 */
export async function uploadImage(
  target: MetaTarget,
  url: string,
): Promise<string> {
  // Our own blob storage, but read with a deadline and a ceiling all the same:
  // this runs inside a serverless function with a shared budget, and the whole
  // image is about to be held in memory twice (raw, then base64).
  const res = await fetch(url, { signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`Could not read the image at ${url} (${res.status}).`);
  }
  const bytes = Buffer.from(await readBoundedBytes(res, MAX_IMAGE_BYTES)).toString(
    "base64",
  );
  const json = await graphPost<{ images?: Record<string, { hash?: string }> }>(
    target,
    `${target.accountId}/adimages`,
    { bytes },
  );
  const hash = Object.values(json.images ?? {})[0]?.hash;
  if (!hash) throw new Error("Meta accepted the image but returned no hash.");
  return hash;
}

/**
 * Upload a video and wait for Meta to finish processing it.
 *
 * Processing outlasts the request that started it, so the caller stores the
 * returned id and polls separately rather than holding a function open.
 */
export async function uploadVideo(
  target: MetaTarget,
  url: string,
): Promise<string> {
  const json = await graphPost<{ id?: string }>(
    target,
    `${target.accountId}/advideos`,
    { file_url: url },
  );
  if (!json.id) throw new Error("Meta accepted the video but returned no id.");
  return json.id;
}

/** Whether an uploaded video has finished processing. */
export async function videoReady(
  target: MetaTarget,
  videoId: string,
): Promise<boolean> {
  const search = new URLSearchParams({
    access_token: target.accessToken,
    fields: "status",
  });
  const { res, text } = await fetchBounded(
    `https://graph.facebook.com/${target.apiVersion}/${videoId}?${search}`,
  );
  if (!res.ok) return false;
  const json = JSON.parse(text) as {
    status?: { video_status?: string };
  };
  return json.status?.video_status === "ready";
}

/**
 * The name Meta stores, with the draft tag appended.
 *
 * Creative creation is the one step in the sequence whose result is not
 * recoverable from anywhere else: the ad is findable by this tag and the image
 * hashes are saved on the draft, but a creative made by a request that then
 * timed out would otherwise be an anonymous row in Ads Manager. Naming it means
 * an outcome-unknown action can actually be resolved by a person.
 */
function taggedName(input: CreateAdInput): string {
  return input.draftTag ? `${input.name} [pb:${input.draftTag}]` : input.name;
}

/**
 * Build the creative.
 *
 * With both ratios present this uses placement asset customization: the 1:1 in
 * feeds, the 9:16 in stories and reels. The alternative is letting Meta crop
 * one image for every placement, which is what the doc's "a 1:1 and a 9:16 are
 * needed" instruction exists to avoid.
 *
 * Meta requires more than one customization rule for a valid asset_feed_spec,
 * so a draft with a single ratio falls back to a plain creative rather than
 * sending a spec that would be rejected.
 */
export function buildCreativeParams(input: CreateAdInput): Record<string, string> {
  const square = input.assets.find((a) => a.ratio === "1:1");
  const vertical = input.assets.find((a) => a.ratio === "9:16");

  const storySpec: Record<string, unknown> = { page_id: input.pageId };
  // instagram_user_id, not instagram_actor_id: the latter has been unsupported
  // since v22.0 and silently writes to a field Meta no longer reads.
  if (input.instagramUserId) storySpec.instagram_user_id = input.instagramUserId;

  const both = square && vertical;
  if (!both) {
    const only = square ?? vertical;
    if (!only) throw new Error("A draft needs at least one image.");
    return {
      name: taggedName(input),
      object_story_spec: JSON.stringify({
        ...storySpec,
        link_data: {
          image_hash: only.metaHash,
          link: input.linkUrl,
          message: input.primaryText,
          name: input.headline,
          description: input.description ?? "",
          call_to_action: { type: input.callToAction },
        },
      }),
    };
  }

  return {
    name: taggedName(input),
    object_story_spec: JSON.stringify(storySpec),
    asset_feed_spec: JSON.stringify({
      ad_formats: ["SINGLE_IMAGE"],
      images: [
        { hash: square.metaHash, adlabels: [{ name: FEED_LABEL }] },
        { hash: vertical.metaHash, adlabels: [{ name: STORY_LABEL }] },
      ],
      bodies: [{ text: input.primaryText }],
      titles: [{ text: input.headline }],
      descriptions: input.description ? [{ text: input.description }] : undefined,
      link_urls: [{ website_url: input.linkUrl }],
      call_to_action_types: [input.callToAction],
      optimization_type: "PLACEMENT",
      asset_customization_rules: [
        {
          customization_spec: {
            publisher_platforms: ["facebook", "instagram"],
            facebook_positions: ["feed"],
            instagram_positions: ["stream"],
          },
          image_label: { name: FEED_LABEL },
        },
        {
          customization_spec: {
            publisher_platforms: ["facebook", "instagram"],
            facebook_positions: ["story", "facebook_reels"],
            instagram_positions: ["story", "reels"],
          },
          image_label: { name: STORY_LABEL },
        },
      ],
    }),
  };
}

export async function createCreative(
  target: MetaTarget,
  input: CreateAdInput,
): Promise<string> {
  const json = await graphPost<{ id?: string }>(
    target,
    `${target.accountId}/adcreatives`,
    buildCreativeParams(input),
  );
  if (!json.id) throw new Error("Meta returned no creative id.");
  return json.id;
}

/**
 * Create the ad itself, paused.
 *
 * The name carries a short tag of the draft it came from. That tag is how a
 * retry finds an ad a previous attempt already created: unlike pausing,
 * creation is not safe to repeat, and without a way to look for its own work a
 * retry after a timeout would make a second ad.
 */
export async function createAd(
  target: MetaTarget,
  input: { adSetId: string; name: string; creativeId: string; draftTag: string },
  options: { validateOnly?: boolean } = {},
): Promise<{ id?: string; validated: boolean }> {
  const params: Record<string, string> = {
    name: `${input.name} [pb:${input.draftTag}]`,
    adset_id: input.adSetId,
    creative: JSON.stringify({ creative_id: input.creativeId }),
    status: "PAUSED",
  };
  if (options.validateOnly) {
    params.execution_options = JSON.stringify(["validate_only"]);
  }
  const json = await graphPost<{ id?: string; success?: boolean }>(
    target,
    `${target.accountId}/ads`,
    params,
  );
  return { id: json.id, validated: Boolean(options.validateOnly) };
}

/**
 * Look for an ad a previous attempt may already have created.
 *
 * Searched by the draft tag in the name, because that is the only identifier
 * that survives a request dying after Meta accepted it but before we recorded
 * the id.
 */
export async function findAdByTag(
  target: MetaTarget,
  adSetId: string,
  draftTag: string,
): Promise<string | null> {
  const search = new URLSearchParams({
    access_token: target.accessToken,
    fields: "id,name",
    limit: "200",
  });
  const { res, text } = await fetchBounded(
    `https://graph.facebook.com/${target.apiVersion}/${adSetId}/ads?${search}`,
  );
  if (!res.ok) return null;
  const json = JSON.parse(text) as { data?: { id: string; name: string }[] };
  const hit = json.data?.find((ad) => ad.name.includes(`[pb:${draftTag}]`));
  return hit?.id ?? null;
}

export { MetaApiError };

/**
 * Change fields on something that already exists.
 *
 * Everything routes through the allowlist rather than trusting its caller,
 * because by phase 4 the caller may be a proposal composed upstream rather than
 * a line of code that names the field. `validateOnly` asks Meta whether it
 * would accept the change without making it, which is what lets a plan be
 * checked before it reaches an approver rather than after they say yes.
 */
export async function updateEntity(
  target: MetaTarget,
  resource: WriteResource,
  entityId: string,
  fields: Record<string, string | number>,
  options: { validateOnly?: boolean } = {},
): Promise<{ success: boolean; validated: boolean }> {
  const verdict = checkFields(resource, "update", fields);
  if (!verdict.ok) throw new Error(verdict.reason);

  const params: Record<string, string | number> = { ...fields };
  if (options.validateOnly) {
    params.execution_options = JSON.stringify(["validate_only"]);
  }
  const json = await graphPost<{ success?: boolean }>(target, entityId, params);
  return { success: json.success !== false, validated: Boolean(options.validateOnly) };
}

/**
 * Create a campaign or an ad set.
 *
 * Both are one-shot and neither is findable by a tag the way an ad is, so a
 * request whose reply is lost leaves something that exists and cannot be
 * matched back. `routeWriteFailure` is what stops that becoming two: creation
 * is the only kind it refuses to retry, and an ambiguous failure here ends in
 * `outcome_unknown` for a person to reconcile.
 *
 * `validateOnly` asks Meta whether it would accept this without making it. A
 * campaign refused for a missing special_ad_categories costs nothing to find
 * out before the approver is asked rather than after.
 */
export async function createStructure(
  target: MetaTarget,
  resource: "campaign" | "adset",
  fields: Record<string, string | number>,
  options: { validateOnly?: boolean } = {},
): Promise<{ id?: string; validated: boolean }> {
  const verdict = checkFields(resource, "create", fields);
  if (!verdict.ok) throw new Error(verdict.reason);
  const status = checkCreateStatus(fields);
  if (!status.ok) throw new Error(status.reason);

  const params: Record<string, string | number> = { ...fields };
  if (options.validateOnly) {
    params.execution_options = JSON.stringify(["validate_only"]);
  }
  const edge = resource === "campaign" ? "campaigns" : "adsets";
  const json = await graphPost<{ id?: string }>(
    target,
    `${target.accountId}/${edge}`,
    params,
  );
  return { id: json.id, validated: Boolean(options.validateOnly) };
}
