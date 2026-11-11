import { test } from "node:test";
import assert from "node:assert/strict";
import { countHashtags, draftWarnings, validateDraft, type DraftShape } from "./validate";

const TARGET = { igUserId: "17841400000000000" };
const JPEG = "https://blob.example.com/a.jpg";

function draft(over: Partial<DraftShape> = {}): DraftShape {
  return {
    channel: "instagram",
    mediaType: "image",
    caption: "Fresh roses, delivered today.",
    mediaUrls: [JPEG],
    ...over,
  };
}

test("a well-formed draft passes", () => {
  assert.equal(validateDraft(draft(), TARGET), null);
  assert.equal(validateDraft(draft({ channel: "facebook", mediaUrls: [] }), TARGET), null);
  assert.equal(
    validateDraft(draft({ channel: "facebook", mediaType: "text", mediaUrls: [] }), TARGET),
    null,
  );
});

test("Instagram needs an account, media, and no text-only post", () => {
  assert.match(validateDraft(draft(), { igUserId: "" })!, /no Instagram account/);
  assert.match(validateDraft(draft({ mediaUrls: [] }), TARGET)!, /at least one image or video/);
  assert.match(validateDraft(draft({ mediaType: "text", mediaUrls: [] }), TARGET)!, /no text-only post/);
});

test("Facebook needs a message or an image", () => {
  assert.match(
    validateDraft(draft({ channel: "facebook", caption: "   ", mediaUrls: [] }), TARGET)!,
    /message or an image/,
  );
});

test("carousels are 2 to 10 items", () => {
  assert.match(validateDraft(draft({ mediaType: "carousel" }), TARGET)!, /at least 2/);
  const eleven = Array.from({ length: 11 }, (_, i) => `https://blob.example.com/${i}.jpg`);
  assert.match(validateDraft(draft({ mediaType: "carousel", mediaUrls: eleven }), TARGET)!, /at most 10/);
  const three = Array.from({ length: 3 }, (_, i) => `https://blob.example.com/${i}.jpg`);
  assert.equal(validateDraft(draft({ mediaType: "carousel", mediaUrls: three }), TARGET), null);
});

test("media must be public https, and JPEG for Instagram", () => {
  assert.match(validateDraft(draft({ mediaUrls: ["http://x.test/a.jpg"] }), TARGET)!, /public https/);
  assert.match(validateDraft(draft({ mediaUrls: ["https://x.test/a.png"] }), TARGET)!, /only accepts JPEG/);
  // Facebook takes a PNG happily.
  assert.equal(
    validateDraft(draft({ channel: "facebook", mediaUrls: ["https://x.test/a.png"] }), TARGET),
    null,
  );
  // A video is not held to the JPEG rule.
  assert.equal(
    validateDraft(draft({ mediaType: "video", mediaUrls: ["https://x.test/a.mp4"] }), TARGET),
    null,
  );
});

test("caption and first comment are capped at 2200", () => {
  assert.match(validateDraft(draft({ caption: "x".repeat(2201) }), TARGET)!, /2200/);
  assert.equal(validateDraft(draft({ caption: "x".repeat(2200) }), TARGET), null);
  assert.match(validateDraft(draft({ firstComment: "x".repeat(2201) }), TARGET)!, /First comment/);
});

test("hashtags are counted across caption and first comment", () => {
  assert.equal(countHashtags("#one #two not#three #four"), 3);
  assert.equal(countHashtags("no tags here"), 0);
  assert.equal(countHashtags("#café #ñoño"), 2);

  const many = Array.from({ length: 20 }, (_, i) => `#tag${i}`).join(" ");
  assert.equal(validateDraft(draft({ caption: many }), TARGET), null);
  assert.match(
    validateDraft(draft({ caption: many, firstComment: many }), TARGET)!,
    /allows 30 hashtags; this has 40/,
  );
});

test("Instagram cannot be scheduled and Facebook has a window", () => {
  const soon = new Date(Date.now() + 60 * 60_000);
  assert.match(validateDraft(draft({ scheduledAt: soon }), TARGET)!, /cannot be scheduled/);
  assert.equal(
    validateDraft(draft({ channel: "facebook", scheduledAt: soon }), TARGET),
    null,
  );
  const tooSoon = new Date(Date.now() + 60_000);
  assert.match(
    validateDraft(draft({ channel: "facebook", scheduledAt: tooSoon }), TARGET)!,
    /10 minutes/,
  );
  // `both` is allowed: the caller splits it into a scheduled FB row and a
  // planned IG draft.
  assert.equal(validateDraft(draft({ channel: "both", scheduledAt: soon }), TARGET), null);
});

test("warnings advise without blocking", () => {
  const long = draftWarnings(draft({ caption: "x".repeat(200) }));
  assert.ok(long.some((w) => /first 125/.test(w.message)));

  const tagged = draftWarnings(draft({ caption: Array.from({ length: 20 }, (_, i) => `#t${i}`).join(" ") }));
  assert.ok(tagged.some((w) => /5-15 reads better/.test(w.message)));

  const both = draftWarnings(draft({ channel: "facebook", linkUrl: "https://x.test" }));
  assert.ok(both.some((w) => /link preview/.test(w.message)));

  assert.deepEqual(draftWarnings(draft()), []);
});
