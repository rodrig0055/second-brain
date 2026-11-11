import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTE_ARG, chatInputSchema, chatToolName, cmsCallKind, describeCmsCall } from "./calls";

test("only known reads run without approval", () => {
  assert.equal(cmsCallKind("cms_reference_data", {}), "read");
  assert.equal(cmsCallKind("product_get", { product_id: 1 }), "read");
  assert.equal(cmsCallKind("product_create", {}), "write");
  assert.equal(cmsCallKind("product_connections", { kind: "related" }), "write");
  assert.equal(cmsCallKind("variant_image_delete", {}), "write");
});

test("a tool the CMS adds later is a write until code says otherwise", () => {
  assert.equal(cmsCallKind("product_delete", {}), "write");
});

test("publishing is its own kind, even with validate_only", () => {
  assert.equal(cmsCallKind("product_publish", {}), "publish");
  assert.equal(cmsCallKind("product_publish", { validate_only: true }), "publish");
});

test("validate_only and the reading composition actions write nothing", () => {
  assert.equal(cmsCallKind("product_create", { validate_only: true }), "read");
  assert.equal(cmsCallKind("product_update", { validate_only: false }), "write");
  assert.equal(cmsCallKind("product_composition", { action: "show" }), "read");
  assert.equal(cmsCallKind("product_composition", { action: "save_group" }), "write");
  assert.equal(cmsCallKind("product_composition", { action: "set_bundle" }), "write");
});

test("the model never sees tenant", () => {
  const schema = {
    type: "object",
    properties: { tenant: { type: "string" }, product_id: { type: "integer" } },
    required: ["tenant", "product_id"],
  };
  const out = chatInputSchema(schema, { withNote: false });
  assert.deepEqual(Object.keys(out.properties as object), ["product_id"]);
  assert.deepEqual(out.required, ["product_id"]);
  // the CMS's schema is left as it was
  assert.ok("tenant" in schema.properties);
});

test("writes get an optional note that is not required", () => {
  const out = chatInputSchema({ type: "object", properties: {}, required: ["tenant"] }, { withNote: true });
  assert.ok(NOTE_ARG in (out.properties as object));
  assert.deepEqual(out.required, []);
});

test("chat names are prefixed once", () => {
  assert.equal(chatToolName("product_get"), "cms_product_get");
  assert.equal(chatToolName("cms_reference_data"), "cms_reference_data");
});

test("summaries say what will happen", () => {
  assert.equal(
    describeCmsCall("product_connections", { product_id: 380, kind: "related", add: [572, 501] }),
    "Change related products of product #380: add 572, 501",
  );
  assert.equal(
    describeCmsCall("product_create", { name: "Rosy", variants: [{}, {}], hub_ids: [1] }),
    'Create draft product "Rosy" (2 variants on 1 hub)',
  );
  assert.equal(
    describeCmsCall("product_update", { product_id: 4, name: "x", meta: {}, [NOTE_ARG]: "why" }),
    "Edit product #4: name, meta",
  );
  assert.equal(describeCmsCall("product_publish", { product_id: 9, product: { published: true } }), "Publish product #9");
  assert.equal(
    describeCmsCall("product_publish", { product_id: 9, variants: [{ variant_id: 1, published: false }] }),
    "Unpublish product #9",
  );
  assert.equal(
    describeCmsCall("product_publish", { product_id: 9, product: { published: true, bloomly_published: false } }),
    "Change publishing of product #9",
  );
});

test("banner and flash sale reads run, their publishes need an admin", () => {
  for (const t of ["banner_list", "banner_get", "flash_deal_list", "flash_deal_get", "flash_price_list", "flash_price_get"]) {
    assert.equal(cmsCallKind(t, {}), "read", t);
  }
  for (const t of ["banner_create", "banner_update", "banner_reorder", "banner_translation_set", "flash_deal_create", "flash_deal_update", "flash_price_create", "flash_price_update"]) {
    assert.equal(cmsCallKind(t, {}), "write", t);
  }
  for (const t of ["banner_publish", "flash_deal_publish", "flash_price_publish"]) {
    assert.equal(cmsCallKind(t, {}), "publish", t);
  }
  // a publish tool the CMS adds later is admin-only from the start
  assert.equal(cmsCallKind("voucher_publish", {}), "publish");
});

test("banner and flash sale summaries say what will happen", () => {
  assert.equal(describeCmsCall("banner_publish", { kind: "mobile", banner_id: 3, published: true }), "Publish app banner #3");
  assert.equal(describeCmsCall("flash_deal_publish", { flash_deal_id: 100, published: false }), "Unpublish flash deal #100");
  assert.equal(describeCmsCall("flash_price_publish", { flash_price_id: 7, published: true }), "Publish flash price #7");
  assert.equal(
    describeCmsCall("flash_deal_create", { title: "Digital Cards", products: [{}, {}], start_date: "2026-11-01T00:00", end_date: "2026-11-02T00:00" }),
    'Create unpublished flash deal "Digital Cards" (2 products, 2026-11-01T00:00 to 2026-11-02T00:00)',
  );
  assert.equal(
    describeCmsCall("banner_update", { kind: "web", banner_id: 3, link: "/x", [NOTE_ARG]: "why" }),
    "Edit web banner #3: link",
  );
  assert.equal(describeCmsCall("banner_reorder", { kind: "web", banner_ids: [3, 1, 2] }), "Reorder 3 web banners: 3, 1, 2");
});
