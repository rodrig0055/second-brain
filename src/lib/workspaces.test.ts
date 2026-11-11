import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_ADS_TEAM_SLUG,
  META_ADS_TEAM_SLUG,
  SOCIAL_TEAM_SLUG,
  WORKSPACES,
  WORKSPACE_ALIASES,
  channelWorkspaces,
  hasCapability,
  isChannelWorkspace,
  slugsWith,
  workspaceFocus,
  workspaceFor,
  workspaceHome,
  workspaceHref,
  workspacePlatforms,
  workspaceTabs,
} from "./workspaces";

test("every workspace has unique tab keys and hrefs", () => {
  for (const ws of Object.values(WORKSPACES)) {
    const keys = ws.tabs.map((t) => t.key);
    const hrefs = ws.tabs.map((t) => t.href);
    assert.equal(new Set(keys).size, keys.length, `${ws.slug} has duplicate tab keys`);
    assert.equal(new Set(hrefs).size, hrefs.length, `${ws.slug} has duplicate tab hrefs`);
    // A generic team is rooted at /t/<slug>; a channel workspace lives one
    // level down (/ads, /social) and the bare team route redirects into it.
    // So does a team whose landing tab is a page of its own (/review).
    const rooted = ws.tabs.some((t) => t.href === "");
    const landingHref = ws.tabs.find((t) => t.key === ws.landing)?.href ?? "";
    const ownLanding = ws.kind === "team" && landingHref !== "";
    assert.equal(rooted, ws.kind === "team" && !ownLanding, `${ws.slug} roots its tabs at the wrong level`);
  }
});

test("a workspace's own slug matches its registry key", () => {
  for (const [key, ws] of Object.entries(WORKSPACES)) assert.equal(ws.slug, key);
});

test("channel workspaces declare a brand scope and a landing tab that exists", () => {
  const channels = channelWorkspaces();
  assert.equal(channels.length, 2);
  for (const ws of channels) {
    assert.ok(ws.scopePlatforms?.length, `${ws.slug} has no scopePlatforms`);
    assert.ok(ws.landing, `${ws.slug} has no landing tab`);
    assert.ok(
      ws.tabs.some((t) => t.key === ws.landing),
      `${ws.slug} landing tab "${ws.landing}" is not one of its tabs`,
    );
    assert.ok(ws.stickyParams?.includes("brands"), `${ws.slug} does not carry the brand scope`);
  }
});

test("an unknown team still gets the generic surface", () => {
  const ws = workspaceFor("not-a-real-team");
  assert.equal(ws.kind, "team");
  assert.deepEqual(
    ws.tabs.map((t) => t.key),
    ["overview", "tasks", "outputs", "dashboards"],
  );
  assert.equal(isChannelWorkspace("not-a-real-team"), false);
});

test("tool platform scoping matches what the teams had before", () => {
  assert.deepEqual(workspacePlatforms(META_ADS_TEAM_SLUG), ["meta", "meta_organic"]);
  assert.deepEqual(workspacePlatforms(SOCIAL_TEAM_SLUG), ["meta_organic", "meta", "tiktok_organic"]);
  assert.deepEqual(workspacePlatforms("newsletter"), ["sendpulse"]);
  assert.deepEqual(workspacePlatforms("seo"), ["ga4"]);
  assert.deepEqual(workspacePlatforms("commercial"), ["shopify", "ga4"]);
  // Unscoped: no team, an unmapped team, and Google Ads (its templates call
  // both meta* and googleAds* tools).
  assert.equal(workspacePlatforms(undefined), undefined);
  assert.equal(workspacePlatforms("wholesale"), undefined);
  assert.equal(workspacePlatforms(GOOGLE_ADS_TEAM_SLUG), undefined);
});

test("capabilities replace the old slug literals", () => {
  assert.deepEqual(slugsWith("adsCockpit"), [META_ADS_TEAM_SLUG]);
  assert.equal(hasCapability(SOCIAL_TEAM_SLUG, "socialDrafting"), true);
  assert.equal(hasCapability(META_ADS_TEAM_SLUG, "socialDrafting"), false);
  assert.equal(hasCapability(META_ADS_TEAM_SLUG, "metaExactLookup"), true);
  assert.equal(hasCapability("seo", "gscTools"), true);
  assert.equal(hasCapability("seo", "seoTools"), true);
  assert.equal(hasCapability("commercial", "storefrontTools"), true);
  assert.equal(hasCapability("commercial", "gscTools"), false);
  // No team at all is never a capability holder; callers keep their own
  // `!teamSlug ||` fallback where a background pass needs one.
  assert.equal(hasCapability(undefined, "gscTools"), false);
});

test("the social focus states the Facebook reach rule", () => {
  const focus = workspaceFocus(SOCIAL_TEAM_SLUG) ?? "";
  assert.match(focus, /no reach/i);
  assert.match(focus, /never report 0 reach/i);
  assert.ok(workspaceFocus("not-a-real-team") === undefined);
});

test("hrefs and the home link build from the registry", () => {
  assert.equal(workspaceHref(SOCIAL_TEAM_SLUG, "connections"), "/t/social-media/social/connections");
  assert.equal(workspaceHref(META_ADS_TEAM_SLUG), "/t/meta-ads");
  assert.equal(
    workspaceHref(META_ADS_TEAM_SLUG, "performance", { brands: "acme-florals", range: undefined }),
    "/t/meta-ads/ads/performance?brands=acme-florals",
  );
  assert.equal(workspaceHome(SOCIAL_TEAM_SLUG), "/t/social-media/social");
  assert.equal(workspaceHome("wholesale"), "/t/wholesale");
});

test("aliases point at a real workspace and never at themselves", () => {
  for (const [from, to] of Object.entries(WORKSPACE_ALIASES)) {
    assert.notEqual(from, to);
    assert.ok(WORKSPACES[to], `alias ${from} points at unknown ${to}`);
    assert.equal(WORKSPACES[from], undefined, `alias ${from} is also a live workspace`);
  }
});

test("neither channel workspace keeps the generic Dashboards pill", () => {
  for (const ws of channelWorkspaces()) {
    assert.equal(
      ws.tabs.some((t) => t.key === "dashboards"),
      false,
      `${ws.slug} still has a Dashboards tab`,
    );
  }
  assert.equal(
    workspaceTabs("newsletter").some((t) => t.key === "dashboards"),
    true,
  );
});
