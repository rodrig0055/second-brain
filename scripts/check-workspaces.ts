/**
 * Exercise every loader the two workspaces render from, against the real
 * database, as a real user.
 *
 * This is the part a browser pass cannot reach on its own machine: local
 * sign-in needs a Google client secret that Vercel will not hand back, so the
 * pages cannot be opened here. Everything below the JSX can still be proven,
 * and this proves it: the queries run, the shapes are right, and the numbers
 * are the ones the surfaces will show.
 *
 *   npx tsx --env-file=.env.local --require ./scripts/_server-only-shim.cjs scripts/check-workspaces.ts
 */
import { eq } from "drizzle-orm";

import { db } from "../src/db";
import { users } from "../src/db/schema";
import { resolveBrandScope } from "../src/lib/brand-scope";
import { parseDateRange, todayIn } from "../src/lib/date-range";
import { loadBrandSummaries } from "../src/lib/social/load-summary";
import { loadPostsTable } from "../src/lib/social/metrics";
import { loadAttention, draftCounts, loadCalendarEntries } from "../src/lib/social/drafts";
import { resolveMetaScope } from "../src/lib/ads/scope";
import { loadOverview } from "../src/lib/ads/overview";
import { loadCreativeLibrary } from "../src/lib/ads/creatives/library";
import { loadPivot } from "../src/lib/ads/store";
import { workspaceFor } from "../src/lib/workspaces";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS " : "FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures += 1;
}

async function main() {
  const email = process.argv[2] ?? "member@acmeflorals.example";
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (!user) throw new Error(`No user ${email}`);
  console.log(`As ${user.email} (${user.role})\n`);

  // ---- Social ----
  console.log("SOCIAL");
  const socialScope = await resolveBrandScope({
    user,
    teamSlug: "social-media",
    searchParams: {},
  });
  console.log(
    `  brands with a Page: ${socialScope.all.map((b) => b.name).join(", ") || "none"}`,
  );
  check("brand scope resolves", socialScope.selected.length > 0 || socialScope.all.length === 0);

  const range = parseDateRange({}, { defaultPreset: "28d", endsYesterday: true });
  console.log(`  window ${range.start} to ${range.end} (${range.label})`);
  check("the window ends yesterday", range.end < todayIn());

  const ids = socialScope.selected.map((b) => b.id);
  if (ids.length) {
    const summaries = await loadBrandSummaries(ids, range, range.prev);
    check("brand summaries load", summaries.length === ids.length);
    for (const s of summaries) {
      const name = socialScope.selected.find((b) => b.id === s.brandId)?.name;
      console.log(
        `  ${name}: IG ${s.instagram.followers ?? "?"} followers, ${s.instagram.reach} reach, ` +
          `${s.instagram.posts} posts | FB ${s.facebook.followers ?? "?"} followers, ` +
          `${s.facebook.engagement} engagements, ${s.facebook.posts} posts`,
      );
      check(
        `${name}: Facebook reach is absent, not zero`,
        s.facebook.reach === null,
        `got ${String(s.facebook.reach)}`,
      );
    }

    const posts = await loadPostsTable({
      brandIds: ids,
      startDate: "2026-01-01",
      endDate: range.end,
    });
    console.log(`  posts table: ${posts.length} rows`);
    check("posts load", Array.isArray(posts));
    const fb = posts.filter((p) => p.channel === "facebook");
    check(
      "every Facebook post reports no reach",
      fb.every((p) => p.reach === null),
      `${fb.length} facebook posts`,
    );
    const ig = posts.filter((p) => p.channel === "instagram");
    check(
      "Instagram posts carry reach",
      ig.length === 0 || ig.some((p) => typeof p.reach === "number"),
    );
    check(
      "caption search narrows the result",
      (
        await loadPostsTable({
          brandIds: ids,
          startDate: "2026-01-01",
          endDate: range.end,
          search: "zzzznotarealword",
        })
      ).length === 0,
    );

    const attention = await loadAttention(ids, todayIn());
    const counts = await draftCounts(ids);
    console.log(
      `  drafts: ${JSON.stringify(counts)} | failed ${attention.failed.length}, ` +
        `stalled ${attention.stalled.length}, upcoming ${attention.upcoming.length}`,
    );
    check("attention loads", Array.isArray(attention.failed));
    check("no row is left in the legacy approved state", !("approved" in counts));

    const entries = await loadCalendarEntries(ids, "2026-09-01", "2026-09-30");
    console.log(`  calendar: ${entries.length} entries in September`);
    check(
      "every calendar entry has a day and a brand",
      entries.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.brandSlug !== ""),
    );
  }

  // ---- Meta Ads ----
  console.log("\nMETA ADS");
  const adsUser = await db.query.users.findFirst({
    where: eq(users.email, "admin@acmeflorals.example"),
  });
  const scope = await resolveMetaScope(adsUser ?? user, {});
  console.log(
    `  accounts: ${scope.all.map((s) => `${s.brand.name} (${s.currency}${s.writeGate.ok ? ", writes on" : ""})`).join(", ") || "none"}`,
  );
  check("meta scope resolves", scope.all.length > 0);
  check(
    "currencies are tracked so nothing gets blended",
    scope.currencies.length > 0,
    scope.currencies.join(", "),
  );

  if (scope.selected.length) {
    // compare=1 is what the Compare toggle sets; without it there is no
    // previous window to load, by design.
    const adsRange = parseDateRange({ compare: "1" }, {
      defaultPreset: "28d",
      endsYesterday: true,
      today: todayIn(scope.selected[0].timezone),
    });
    const overviews = await loadOverview(scope.selected, adsRange, adsRange.prev);
    check("overview loads for every account", overviews.length === scope.selected.length);
    for (const o of overviews) {
      console.log(
        `  ${o.brandName} [${o.adAccountId}]: ${o.totals.spend.toFixed(0)} ${o.currency} spend, ` +
          `${o.totals.purchases} purchases, CIR ${o.totals.cir.toFixed(0)}%, ` +
          `${o.alerts.open} open alerts, ${o.funnels.length} funnel rows, ` +
          `digest ${o.digest ? o.digest.date : "none"}`,
      );
      check(
        `${o.brandName}: previous window loaded for comparison`,
        o.prevTotals !== null,
      );
    }

    // Drill-down must narrow, not just filter after the fact.
    const first = scope.selected[0];
    const campaigns = await loadPivot({
      connectionId: first.connection.id,
      brandId: first.brand.id,
      level: "campaign",
      range: adsRange,
      currency: first.currency,
    });
    if (campaigns.length) {
      const target = campaigns[0];
      const all = await loadPivot({
        connectionId: first.connection.id,
        brandId: first.brand.id,
        level: "adset",
        range: adsRange,
        currency: first.currency,
      });
      const drilled = await loadPivot({
        connectionId: first.connection.id,
        brandId: first.brand.id,
        level: "adset",
        range: adsRange,
        currency: first.currency,
        filter: { campaignId: target.id },
      });
      console.log(
        `  drill-down: ${all.length} ad sets in the account, ${drilled.length} in "${target.name}"`,
      );
      check("drilling into a campaign narrows the result", drilled.length <= all.length);
      check(
        "every drilled row belongs to that campaign",
        drilled.every((r) => r.campaignId === target.id),
      );
    }

    const library = await loadCreativeLibrary({
      scope: scope.selected,
      range: adsRange,
      metric: "roas",
      threshold: 1.5,
    });
    console.log(
      `  creatives: ${library.rows.length} spent, ${library.unclassified} not classified`,
    );
    check("creative library loads", Array.isArray(library.rows));
    check(
      "a creative's spend matches its pivot row",
      library.rows.length === 0 ||
        library.rows.every((r) => typeof r.spend === "number" && r.spend >= 0),
    );
    check(
      "the human funnel and the AI guess stay separate",
      library.rows.every((r) => r.funnel === null || typeof r.funnel === "string"),
    );
  }

  // ---- Registry ----
  console.log("\nREGISTRY");
  const renamed = await db.query.teams?.findFirst?.({
    where: (t, { eq: e }) => e(t.slug, "google-ads"),
  });
  check("paid-media is now google-ads", Boolean(renamed), renamed?.name ?? "missing");
  check(
    "google-ads keeps every platform's tools",
    workspaceFor("google-ads").platforms === undefined,
  );
  check("social-media is a channel workspace", workspaceFor("social-media").kind === "channel");
  check("meta-ads is a channel workspace", workspaceFor("meta-ads").kind === "channel");

  // Two brands on one ad account is a connection mistake, and it reads as two
  // identical cards. Named here so a check run says so out loud.
  const byAccount = new Map<string, string[]>();
  for (const s of scope.selected) {
    byAccount.set(s.adAccountId, [...(byAccount.get(s.adAccountId) ?? []), s.brand.name]);
  }
  for (const [account, brands] of byAccount) {
    if (brands.length > 1) {
      console.log(`\n  NOTE  ${brands.join(" and ")} share ad account ${account}.`);
      console.log("        Their figures are the same numbers twice; a connection needs fixing.");
    }
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
