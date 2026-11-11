import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_TIKTOK_OPTIONS,
  tiktokOptions,
  tiktokPermalink,
  validateTiktokDraft,
  verifiedMediaPrefixes,
} from "./tiktok-rules";
import { validateDraft } from "./validate";

const PREFIX = "https://pub-x.r2.dev/social/";
const draft = (over: Partial<Parameters<typeof validateTiktokDraft>[0]> = {}) => ({
  mediaType: "video",
  caption: "Hook first. #flowers",
  mediaUrls: [`${PREFIX}b/clip.mp4`],
  options: DEFAULT_TIKTOK_OPTIONS,
  ...over,
});

test("a video under the verified prefix passes", () => {
  assert.equal(validateTiktokDraft(draft(), [PREFIX]), null);
});

test("TikTok refuses PNG on a photo post, which is what the image studio writes", () => {
  const err = validateTiktokDraft(
    draft({ mediaType: "image", mediaUrls: [`${PREFIX}b/a.png`] }),
    [PREFIX],
  );
  assert.match(err ?? "", /JPG or WebP/);
  assert.equal(
    validateTiktokDraft(draft({ mediaType: "carousel", mediaUrls: [`${PREFIX}a.jpg`, `${PREFIX}b.webp`] }), [PREFIX]),
    null,
  );
});

test("media outside the verified prefix is caught before TikTok rejects it", () => {
  const err = validateTiktokDraft(draft({ mediaUrls: ["https://elsewhere.example/clip.mp4"] }), [PREFIX]);
  assert.match(err ?? "", /not under a verified URL prefix/);
  // No prefix configured at all is its own, actionable message.
  assert.match(validateTiktokDraft(draft(), []) ?? "", /TIKTOK_MEDIA_PREFIXES/);
  // Saving a draft skips the check; publishing does not.
  assert.equal(validateTiktokDraft(draft({ mediaUrls: ["https://elsewhere.example/clip.mp4"] }), null), null);
});

test("caption limits differ between video and photo posts", () => {
  const long = "a".repeat(3000);
  assert.match(validateTiktokDraft(draft({ caption: long }), [PREFIX]) ?? "", /2200/);
  assert.equal(
    validateTiktokDraft(draft({ mediaType: "image", caption: long, mediaUrls: [`${PREFIX}a.jpg`] }), [PREFIX]),
    null,
  );
});

test("a video post takes exactly one video and no text-only post exists", () => {
  assert.match(
    validateTiktokDraft(draft({ mediaUrls: [`${PREFIX}a.mp4`, `${PREFIX}b.mp4`] }), [PREFIX]) ?? "",
    /exactly one/,
  );
  assert.match(validateTiktokDraft(draft({ mediaType: "text", mediaUrls: [] }), [PREFIX]) ?? "", /text-only/);
});

test("stored options fall back to the defaults field by field", () => {
  const o = tiktokOptions({ isAiGenerated: true, title: 7 as unknown as string });
  assert.equal(o.isAiGenerated, true);
  assert.equal(o.isBrandOrganic, true);
  assert.equal(o.title, "");
});

test("prefixes are normalized to end in a slash", () => {
  assert.deepEqual(verifiedMediaPrefixes(" https://a.dev/social , https://b.dev/x/ "), [
    "https://a.dev/social/",
    "https://b.dev/x/",
  ]);
});

test("permalinks point at the right post kind", () => {
  assert.equal(tiktokPermalink("bloomly-ph.example", "123", "video"), "https://www.tiktok.com/@bloomly-ph.example/video/123");
  assert.equal(tiktokPermalink("bloomly-ph.example", "123", "carousel"), "https://www.tiktok.com/@bloomly-ph.example/photo/123");
});

test("Meta's validator refuses a TikTok draft instead of checking it as Instagram", () => {
  assert.match(
    validateDraft(
      { channel: "tiktok", mediaType: "video", caption: "x", mediaUrls: ["https://a/b.mp4"] },
      { igUserId: "1" },
    ) ?? "",
    /TikTok draft/,
  );
});
