import assert from "node:assert/strict";
import test from "node:test";
import { planUpload, SOCIAL_VIDEO_UPLOADS, UPLOAD_LIMITS } from "./browser-upload-plan";

const fixed = () => "r4nd0m";
const ok = { pathname: "customsong/order-1/inputs/photo (2).jpg", contentType: "image/jpeg", size: 1000 };

test("the key gets a random suffix before the extension, and the download keeps the real name", () => {
  const plan = planUpload(ok, fixed);
  assert.deepEqual(plan, {
    key: "customsong/order-1/inputs/photo (2)-r4nd0m.jpg",
    contentType: "image/jpeg",
    downloadName: "photo (2).jpg",
  });
});

test("a file with no extension still gets a suffix", () => {
  const plan = planUpload({ ...ok, pathname: "customsong/o/inputs/lyrics" }, fixed);
  assert.equal("key" in plan && plan.key, "customsong/o/inputs/lyrics-r4nd0m");
});

test("uploads outside customsong/ are refused, including by walking up", () => {
  for (const pathname of ["generated/1/a.png", "../generated/a.png", "customsong/../brand-assets/x.png", "customsong", "/"]) {
    assert.ok("error" in planUpload({ ...ok, pathname }, fixed), pathname);
  }
});

test("dot segments are dropped rather than trusted", () => {
  const plan = planUpload({ ...ok, pathname: "customsong/./o//inputs/a.jpg" }, fixed);
  assert.equal("key" in plan && plan.key, "customsong/o/inputs/a-r4nd0m.jpg");
});

test("types outside the allowlist and oversized or empty files are refused", () => {
  assert.ok("error" in planUpload({ ...ok, contentType: "text/html" }, fixed));
  assert.ok("error" in planUpload({ ...ok, contentType: "image/svg+xml" }, fixed));
  assert.ok("error" in planUpload({ ...ok, size: UPLOAD_LIMITS.maxBytes + 1 }, fixed));
  assert.ok("error" in planUpload({ ...ok, size: 0 }, fixed));
});

test("content type parameters and case do not dodge the allowlist", () => {
  const plan = planUpload({ ...ok, contentType: "Image/JPEG; charset=binary" }, fixed);
  assert.equal("contentType" in plan && plan.contentType, "image/jpeg");
});

test("social video: MP4 and MOV under social/ are accepted, with the same suffix rule", () => {
  const mov = planUpload({ pathname: "social/reel.mov", contentType: "video/quicktime", size: 80 * 1024 * 1024 }, fixed, SOCIAL_VIDEO_UPLOADS);
  assert.deepEqual(mov, { key: "social/reel-r4nd0m.mov", contentType: "video/quicktime", downloadName: "reel.mov" });
});

test("social video: the policy keeps each route inside its own prefix and file types", () => {
  const v = { pathname: "social/a.mp4", contentType: "video/mp4", size: 1000 };
  assert.ok("key" in planUpload(v, fixed, SOCIAL_VIDEO_UPLOADS));
  // a social token cannot write into customsong/, and the default policy cannot write into social/
  assert.ok("error" in planUpload({ ...v, pathname: "customsong/o/a.mp4" }, fixed, SOCIAL_VIDEO_UPLOADS));
  assert.ok("error" in planUpload(v, fixed));
  // images and audio go elsewhere
  assert.ok("error" in planUpload({ ...v, contentType: "image/jpeg" }, fixed, SOCIAL_VIDEO_UPLOADS));
  assert.ok("error" in planUpload({ ...v, contentType: "audio/mpeg" }, fixed, SOCIAL_VIDEO_UPLOADS));
});

test("social video: the 300 MB cap is its own, not Custom Song's 50 MB", () => {
  const v = { pathname: "social/a.mp4", contentType: "video/mp4" };
  assert.ok("key" in planUpload({ ...v, size: 200 * 1024 * 1024 }, fixed, SOCIAL_VIDEO_UPLOADS));
  const over = planUpload({ ...v, size: 301 * 1024 * 1024 }, fixed, SOCIAL_VIDEO_UPLOADS);
  assert.ok("error" in over && over.error.includes("300 MB"));
});
