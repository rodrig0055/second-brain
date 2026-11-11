/**
 * Prints the account context the ad brief writes from.
 *
 *   npx tsx scripts/check-ad-brief-context.ts [--brand acme-florals] [--days 30]
 *
 * The suggestions are only as good as this block, and this block is built from
 * stored insights with no model involved — so it can be read, checked against
 * the cockpit table, and disagreed with, before anyone spends tokens on copy.
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
  const days = Number(arg("days") ?? 30);

  const { db } = await import("../src/db");
  const { brands, integrationConnections } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { briefText } = await import("../src/lib/ads/drafts/context");
  const { loadDraftContext } = await import("../src/lib/ads/drafts/load-context");

  const brand = await db.query.brands.findFirst({
    where: eq(brands.slug, brandSlug),
  });
  if (!brand) throw new Error(`No brand with slug "${brandSlug}".`);

  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brand.id),
      eq(integrationConnections.platform, "meta"),
    ),
  });
  if (!connection) throw new Error(`${brand.name} has no Meta connection.`);

  const context = await loadDraftContext({
    connectionId: connection.id,
    brandId: brand.id,
    brandName: brand.name,
    currency: String(connection.config?.currency ?? "USD"),
    range: { start: ymd(days), end: ymd(1) },
    windowDays: days,
  });

  console.log(briefText(context));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
