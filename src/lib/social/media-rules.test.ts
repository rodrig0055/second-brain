import { test } from "node:test";
import assert from "node:assert/strict";
import { aspectOf, classifyUrl, describeAspect, matchesAspect, mediaProblems } from "./media-rules";

test("classifyUrl reads the extension, query string and all", () => {
  assert.equal(classifyUrl("https://x.test/a.jpg"), "image");
  assert.equal(classifyUrl("https://x.test/a.PNG?v=2"), "image");
  assert.equal(classifyUrl("https://x.test/a.mp4"), "video");
  assert.equal(classifyUrl("https://x.test/a.mov?x=1"), "video");
  assert.equal(classifyUrl("https://x.test/no-extension"), "unknown");
});

test("describeAspect names the shapes people ask for", () => {
  assert.equal(describeAspect(1080, 1080), "1:1");
  assert.equal(describeAspect(1080, 1350), "4:5");
  assert.equal(describeAspect(1080, 1920), "9:16");
  assert.equal(describeAspect(1200, 628), "1.91:1");
  assert.equal(describeAspect(1000, 250), "4.00:1");
});

test("aspect helpers", () => {
  assert.equal(aspectOf(1080, 1080), 1);
  assert.equal(aspectOf(100, 0), 0);
  assert.equal(matchesAspect(1.01, 1), true);
  assert.equal(matchesAspect(1.2, 1), false);
});

test("Instagram feed images outside the band are flagged", () => {
  assert.deepEqual(mediaProblems("instagram", "image", [{ url: "a", width: 1080, height: 1080 }]), []);
  assert.deepEqual(mediaProblems("instagram", "image", [{ url: "a", width: 1080, height: 1350 }]), []);

  const tall = mediaProblems("instagram", "image", [{ url: "a", width: 1080, height: 1920 }]);
  assert.ok(tall.some((p) => /crops anything outside/.test(p)));

  const small = mediaProblems("instagram", "image", [{ url: "a", width: 200, height: 200 }]);
  assert.ok(small.some((p) => /upscales/.test(p)));
});

test("Reels want 9:16", () => {
  assert.deepEqual(mediaProblems("instagram", "video", [{ url: "a", width: 1080, height: 1920 }]), []);
  const square = mediaProblems("instagram", "video", [{ url: "a", width: 1080, height: 1080 }]);
  assert.ok(square.some((p) => /Reels are 9:16/.test(p)));
});

test("a mixed-shape carousel says what Instagram will do to it", () => {
  const mixed = mediaProblems("instagram", "carousel", [
    { url: "a", width: 1080, height: 1080 },
    { url: "b", width: 1080, height: 1350 },
  ]);
  assert.ok(mixed.some((p) => /crops them all to the first/.test(p)));
});

test("Facebook-only posts are not held to Instagram's rules", () => {
  assert.deepEqual(mediaProblems("facebook", "image", [{ url: "a", width: 3000, height: 200 }]), []);
});

test("media with no measured size is skipped rather than guessed at", () => {
  assert.deepEqual(mediaProblems("instagram", "image", [{ url: "a", width: 0, height: 0 }]), []);
});
