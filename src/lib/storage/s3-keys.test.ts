import assert from "node:assert/strict";
import test from "node:test";
import { attachmentDisposition, keyToUrlPath, urlToKey } from "./s3";

/**
 * Keys and URLs have to round-trip exactly: the database stores the URL, and deleting an object means
 * turning that URL back into the key it was written under. Operator filenames carry spaces, brackets
 * and the odd non-ASCII character, which is where a sloppy translation deletes nothing.
 */

const BASE = "https://pub-example.r2.dev";

test("a key survives the trip to a URL and back", () => {
  for (const key of [
    "generated/1/openai_gpt-image-2-feed-v1.png",
    "customsong/abc/inputs/photo_2026-09-22_15-25-34 (2)-a1b2c3.jpg",
    "customsong/abc/inputs/My Best View-a1b2c3.mp3",
    "brand-assets/uuid-Pâtisserie #1 & co.png",
  ]) {
    const url = `${BASE}/${keyToUrlPath(key)}`;
    assert.equal(urlToKey(url, BASE), key, url);
  }
});

test("slashes stay folders, everything else in a segment is encoded", () => {
  assert.equal(keyToUrlPath("a b/c#d/e?.png"), "a%20b/c%23d/e%3F.png");
});

test("URLs from somewhere else are not ours to delete", () => {
  assert.equal(urlToKey("https://abc.public.blob.vercel-storage.com/generated/1/a.png", BASE), null);
  assert.equal(urlToKey(`${BASE}.evil.test/generated/1/a.png`, BASE), null);
  assert.equal(urlToKey(BASE, BASE), null);
  assert.equal(urlToKey(`${BASE}/`, BASE), null);
});

test("a query string or fragment is not part of the key", () => {
  assert.equal(urlToKey(`${BASE}/lyric/a.mp4?download=1`, BASE), "lyric/a.mp4");
  assert.equal(urlToKey(`${BASE}/lyric/a.mp4#t=3`, BASE), "lyric/a.mp4");
});

test("a malformed escape is refused rather than thrown", () => {
  assert.equal(urlToKey(`${BASE}/a/%E0%A4%A.png`, BASE), null);
});

test("the download name is kept, and the ASCII fallback cannot break the header", () => {
  const h = attachmentDisposition('Mañana "final".mp4');
  assert.match(h, /^attachment; filename="Ma_ana _final_.mp4"; filename\*=UTF-8''/);
  assert.ok(h.endsWith(encodeURIComponent('Mañana "final".mp4')));
});
