import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applySelection,
  encodeScopeValue,
  parseScopeValue,
  safeReturnTo,
  scopeCookieName,
  selectionFromSearchParams,
  toggleSlug,
  withQuery,
} from "./brand-scope-params";

const BRANDS = [
  { id: "id-fs", slug: "acme-florals" },
  { id: "id-pph", slug: "bloomly-ph" },
  { id: "id-ba", slug: "northwind-audio" },
];
const ALL_SLUGS = BRANDS.map((b) => b.slug);

test("parseScopeValue reads all, lists and junk", () => {
  assert.deepEqual(parseScopeValue("all"), { all: true });
  assert.deepEqual(parseScopeValue("ALL"), { all: true });
  assert.deepEqual(parseScopeValue("bloomly-ph,acme-florals"), {
    all: false,
    slugs: ["acme-florals", "bloomly-ph"],
  });
  // deduped and sorted, so the same selection always encodes the same way
  assert.deepEqual(parseScopeValue("bloomly-ph, bloomly-ph"), { all: false, slugs: ["bloomly-ph"] });
  assert.equal(parseScopeValue(""), null);
  assert.equal(parseScopeValue(undefined), null);
  assert.equal(parseScopeValue(",, ,"), null);
  assert.deepEqual(parseScopeValue(["bloomly-ph"]), { all: false, slugs: ["bloomly-ph"] });
});

test("encodeScopeValue round-trips", () => {
  for (const raw of ["all", "bloomly-ph", "northwind-audio,bloomly-ph"]) {
    const parsed = parseScopeValue(raw)!;
    assert.equal(parseScopeValue(encodeScopeValue(parsed))!.all, parsed.all);
  }
  assert.equal(encodeScopeValue({ all: false, slugs: ["bloomly-ph", "northwind-audio"] }), "bloomly-ph,northwind-audio");
});

test("applySelection drops brands the user cannot see", () => {
  assert.deepEqual(
    applySelection(BRANDS, { all: false, slugs: ["bloomly-ph", "bloomly-vn"] }, true)?.map((b) => b.slug),
    ["bloomly-ph"],
  );
  // Nothing in common reads as no selection, so the caller falls through to its
  // own default rather than showing an empty page.
  assert.equal(applySelection(BRANDS, { all: false, slugs: ["bloomly-vn"] }, true), null);
  assert.equal(applySelection(BRANDS, { all: true }, true)?.length, 3);
  // A single-brand surface takes the first of a wider selection.
  assert.equal(applySelection(BRANDS, { all: true }, false)?.length, 1);
});

test("selectionFromSearchParams prefers brands= and accepts the legacy brand=", () => {
  assert.deepEqual(selectionFromSearchParams({ brands: "all" }, BRANDS), { all: true });
  assert.deepEqual(selectionFromSearchParams({ brand: "id-pph" }, BRANDS), {
    all: false,
    slugs: ["bloomly-ph"],
  });
  assert.deepEqual(selectionFromSearchParams({ brand: "bloomly-ph" }, BRANDS), {
    all: false,
    slugs: ["bloomly-ph"],
  });
  // brands= wins when both are present
  assert.deepEqual(selectionFromSearchParams({ brands: "all", brand: "id-pph" }, BRANDS), { all: true });
  assert.equal(selectionFromSearchParams({ brand: "unknown-id" }, BRANDS), null);
  assert.equal(selectionFromSearchParams({}, BRANDS), null);
});

test("toggleSlug in single mode always selects exactly one", () => {
  assert.deepEqual(toggleSlug({ all: true }, "bloomly-ph", ALL_SLUGS, "single"), {
    all: false,
    slugs: ["bloomly-ph"],
  });
  assert.deepEqual(
    toggleSlug({ all: false, slugs: ["bloomly-ph"] }, "bloomly-ph", ALL_SLUGS, "single"),
    { all: false, slugs: ["bloomly-ph"] },
  );
});

test("toggleSlug in multi mode adds, removes and collapses to all", () => {
  const one = toggleSlug({ all: false, slugs: ["bloomly-ph"] }, "northwind-audio", ALL_SLUGS, "multi");
  assert.deepEqual(one, { all: false, slugs: ["bloomly-ph", "northwind-audio"] });

  // Selecting every brand is "all", not a list of all of them.
  const everything = toggleSlug(one, "acme-florals", ALL_SLUGS, "multi");
  assert.deepEqual(everything, { all: true });

  // Clicking a brand while on "all" deselects just that one.
  const minusOne = toggleSlug({ all: true }, "bloomly-ph", ALL_SLUGS, "multi");
  assert.deepEqual(minusOne, { all: false, slugs: ["acme-florals", "northwind-audio"] });

  // The last one on stays on.
  const last: { all: false; slugs: string[] } = { all: false, slugs: ["bloomly-ph"] };
  assert.deepEqual(toggleSlug(last, "bloomly-ph", ALL_SLUGS, "multi"), last);
});

test("withQuery sets, keeps and drops", () => {
  assert.equal(withQuery("/t/x/social", { range: "7d" }, { brands: "all" }), "/t/x/social?range=7d&brands=all");
  assert.equal(withQuery("/t/x/social", { range: "7d", brands: "a" }, { brands: null }), "/t/x/social?range=7d");
  assert.equal(withQuery("/t/x/social", {}, {}), "/t/x/social");
  assert.equal(withQuery("/t/x/social", { empty: "" }, {}), "/t/x/social");
});

test("safeReturnTo refuses anything outside the team", () => {
  const fallback = "/t/social-media/social";
  assert.equal(safeReturnTo("social-media", "/t/social-media/social/posts?x=1", fallback), "/t/social-media/social/posts?x=1");
  assert.equal(safeReturnTo("social-media", "/t/meta-ads/ads", fallback), fallback);
  assert.equal(safeReturnTo("social-media", "https://evil.example/t/social-media", fallback), fallback);
  assert.equal(safeReturnTo("social-media", "//evil.example", fallback), fallback);
  assert.equal(safeReturnTo("social-media", "/admin", fallback), fallback);
});

test("the cookie is namespaced per team", () => {
  assert.equal(scopeCookieName("social-media"), "ws-brands.social-media");
  assert.notEqual(scopeCookieName("meta-ads"), scopeCookieName("social-media"));
});
