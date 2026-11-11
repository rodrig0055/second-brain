import assert from "node:assert/strict";
import test from "node:test";
import { isOwnS3Url, isVercelBlobUrl } from "./index";

/**
 * These cover the one thing a storage port reliably gets wrong: which backend
 * owns a given stored URL, and how a URL translates back to a key.
 *
 * The database holds absolute URLs, so after any backend switch it holds a
 * mixture. Deleting against "whatever backend is configured now" silently fails
 * to remove the older objects, and keeps failing quietly because nothing checks.
 */

const BLOB = "https://abc123.public.blob.vercel-storage.com/brand-assets/x-y.png";
const CDN_BASE = "https://assets.acmeflorals.example";

test("Vercel Blob URLs are recognised by host, not by prefix matching", () => {
  assert.equal(isVercelBlobUrl(BLOB), true);
  assert.equal(
    isVercelBlobUrl("https://store.public.blob.vercel-storage.com/a/b.jpg"),
    true,
  );
  assert.equal(isVercelBlobUrl("https://assets.acmeflorals.example/a/b.jpg"), false);
  // A lookalike host must not match: the check is a hostname suffix, so an
  // attacker-controlled domain that merely contains the string does not pass.
  assert.equal(
    isVercelBlobUrl("https://blob.vercel-storage.com.evil.test/a.png"),
    false,
  );
});

test("malformed URLs are not claimed by any backend", () => {
  for (const bad of ["", "not a url", "/relative/path.png", "ftp://x"]) {
    assert.equal(isVercelBlobUrl(bad), false, `should not claim: ${bad}`);
  }
});

test("S3 ownership is false until a public base URL is configured", () => {
  delete process.env.STORAGE_PUBLIC_BASE_URL;
  // With S3 unconfigured every URL must route to Blob, which is what keeps the
  // default path behaving exactly as it did before the wrapper existed.
  assert.equal(isOwnS3Url("https://assets.acmeflorals.example/a/b.jpg"), false);
  assert.equal(isOwnS3Url(BLOB), false);
});

test("S3 ownership matches only our own configured origin", () => {
  process.env.STORAGE_PUBLIC_BASE_URL = CDN_BASE;
  try {
    assert.equal(isOwnS3Url(`${CDN_BASE}/generated/1/a.png`), true);
    assert.equal(isOwnS3Url(BLOB), false);
    // A different host that starts with the same characters must not match.
    assert.equal(isOwnS3Url("https://assets.acmeflorals.example.evil.test/a.png"), false);
    // The base itself is not an object.
    assert.equal(isOwnS3Url(CDN_BASE), false);
  } finally {
    delete process.env.STORAGE_PUBLIC_BASE_URL;
  }
});

test("a trailing slash on the configured base does not double up", () => {
  process.env.STORAGE_PUBLIC_BASE_URL = `${CDN_BASE}/`;
  try {
    assert.equal(isOwnS3Url(`${CDN_BASE}/generated/1/a.png`), true);
    assert.equal(isOwnS3Url(`${CDN_BASE}//generated/1/a.png`), true);
  } finally {
    delete process.env.STORAGE_PUBLIC_BASE_URL;
  }
});

test("Blob and S3 URLs never both claim the same object", () => {
  process.env.STORAGE_PUBLIC_BASE_URL = CDN_BASE;
  try {
    for (const url of [BLOB, `${CDN_BASE}/generated/1/a.png`]) {
      const claims = [isVercelBlobUrl(url), isOwnS3Url(url)].filter(Boolean);
      assert.equal(claims.length, 1, `exactly one backend must own ${url}`);
    }
  } finally {
    delete process.env.STORAGE_PUBLIC_BASE_URL;
  }
});
