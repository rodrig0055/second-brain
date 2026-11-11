import assert from "node:assert/strict";
import test from "node:test";
import { downloadFilename, downloadFormat, downloadHref } from "./image-download";

test("filenames are slugged and take the format's extension", () => {
  assert.equal(
    downloadFilename("Bloomly PH / Instagram post (1:1) · 2.5 Flare v2", "webp"),
    "bloomly-ph-instagram-post-1-1-2-5-flare-v2.webp",
  );
  assert.equal(downloadFilename("Pâtisserie", "jpg"), "patisserie.jpg");
});

test("a hostile or empty name still yields a plain filename", () => {
  assert.equal(downloadFilename("../../etc/passwd", "png"), "etc-passwd.png");
  assert.equal(downloadFilename("", "jpg"), "image.jpg");
  assert.equal(downloadFilename("///", "webp"), "image.webp");
});

test("only the offered formats resolve", () => {
  assert.equal(downloadFormat("jpg")?.mediaType, "image/jpeg");
  assert.equal(downloadFormat("bmp"), undefined);
  assert.equal(downloadFormat(null), undefined);
});

test("the href round-trips the source URL", () => {
  const src = "https://pub-x.r2.dev/generated/abc/openai_gpt-image-2.5-flare-ig-post-v1.png";
  const href = downloadHref(src, "webp", "a b");
  const q = new URL(href, "http://localhost").searchParams;
  assert.equal(q.get("url"), src);
  assert.equal(q.get("format"), "webp");
  assert.equal(q.get("name"), "a b");
});
