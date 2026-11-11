/**
 * End-to-end check of the ad brief: context, prompt, model, guards, lint.
 *
 *   npx tsx --require ./scripts/_server-only-shim.cjs scripts/check-ad-brief.ts \
 *     [--brand acme-florals] [--team meta-ads] [--goal "..."] [--model ...]
 *
 * Makes one real model call and records one task run, so it costs money. It is
 * the only way to prove the whole path, including the guard that an ad set id
 * the model invented is thrown away rather than saved.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function ymd(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

async function main() {
  const brandSlug = arg("brand") ?? "acme-florals";
  const teamSlug = arg("team") ?? "meta-ads";
  const goal =
    arg("goal") ??
    "Push the payday sale to people who already know us. Bouquets from P799, free nationwide shipping.";

  const { db } = await import("../src/db");
  const { brands, integrationConnections, taskTemplates, teams, users } =
    await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { loadDraftContext } = await import("../src/lib/ads/drafts/load-context");
  const { proposeDrafts } = await import("../src/lib/ads/drafts/propose");

  const [brand, team] = await Promise.all([
    db.query.brands.findFirst({ where: eq(brands.slug, brandSlug) }),
    db.query.teams.findFirst({ where: eq(teams.slug, teamSlug) }),
  ]);
  if (!brand) throw new Error(`No brand with slug "${brandSlug}".`);
  if (!team) throw new Error(`No team with slug "${teamSlug}".`);

  const [connection, template, user] = await Promise.all([
    db.query.integrationConnections.findFirst({
      where: and(
        eq(integrationConnections.brandId, brand.id),
        eq(integrationConnections.platform, "meta"),
      ),
    }),
    db.query.taskTemplates.findFirst({
      where: and(
        eq(taskTemplates.teamId, team.id),
        eq(taskTemplates.renderAs, "ad-brief"),
      ),
    }),
    db.query.users.findFirst({ where: eq(users.role, "admin") }),
  ]);
  if (!connection) throw new Error(`${brand.name} has no Meta connection.`);
  if (!template) {
    throw new Error("No ad-brief template. Run scripts/seed-ad-brief-template.ts.");
  }
  if (!user) throw new Error("No admin user to attribute the run to.");

  const context = await loadDraftContext({
    connectionId: connection.id,
    brandId: brand.id,
    brandName: brand.name,
    currency: String(connection.config?.currency ?? "USD"),
    range: { start: ymd(30), end: ymd(1) },
    windowDays: 30,
  });

  console.log(
    `${brand.name} · ${context.winners.length} winners, ${context.losers.length} losers, ` +
      `${context.adSets.length} ad sets · model ${arg("model") ?? template.model}\n`,
  );

  const result = await proposeDrafts({
    templateId: template.id,
    brandId: brand.id,
    userId: user.id,
    inputs: {
      goal,
      purpose: arg("purpose") ?? "PAYDAY",
      eventDate: arg("date") ?? "",
      funnel: arg("funnel") ?? "Let the brain choose",
      linkUrl: "",
      notes: "",
    },
    context,
    model: arg("model"),
  });

  for (const [i, v] of result.variants.entries()) {
    console.log(`--- option ${i + 1} · ${v.funnel} · ${v.concept}`);
    console.log(`headline (${v.headline.length} chars): ${v.headline}`);
    console.log(`primary: ${v.primaryText}`);
    console.log(`ad set: ${v.targetAdSetId || "(none — cleared or not chosen)"}`);
    if (v.adSetWarning) console.log(`! ${v.adSetWarning}`);
    console.log(`button: ${v.callToAction}`);
    console.log(`assets: ${v.assetDirection}`);
    console.log(`why: ${v.rationale}`);
    for (const f of v.findings) console.log(`  [${f.severity}] ${f.field}: ${f.message}`);
    console.log("");
  }
  if (result.note) console.log(`note: ${result.note}`);
  console.log(`task run: ${result.runId}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
