/**
 * Which conversion action types an account actually reports.
 *
 * Meta returns conversions as a list of `{action_type, value}`, and which types
 * appear depends on the pixel, the objective and the account's age. Our mapper
 * picks one type per metric in priority order (src/lib/integrations/meta/
 * counters.ts); this says whether the type it prefers is really there, or
 * whether it is silently falling through to a fallback — or to zero.
 *
 * Worth running when onboarding an account, and after any change to the
 * priority lists. Reads stored rows only, so it needs no Meta credentials.
 *
 *   npx tsx scripts/check-meta-action-types.ts [--brand acme-florals] [--days 30]
 */
import { config } from "dotenv";

config({ path: ".env.local" });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** The metrics we care about, and the names the mapper tries in order. */
const WANTED: Record<string, string[]> = {
  purchases: ["omni_purchase", "offsite_conversion.fb_pixel_purchase", "purchase"],
  addToCart: ["omni_add_to_cart", "offsite_conversion.fb_pixel_add_to_cart", "add_to_cart"],
  initiateCheckout: [
    "omni_initiated_checkout",
    "offsite_conversion.fb_pixel_initiate_checkout",
    "initiate_checkout",
  ],
  landingPageViews: ["landing_page_view"],
  videoViews3s: ["video_view"],
};

async function main() {
  const brandSlug = arg("brand") ?? "acme-florals";
  const days = Number(arg("days") ?? 30);

  const { db } = await import("../src/db");
  const { brands, integrationRecords } = await import("../src/db/schema");
  const { and, eq, gte } = await import("drizzle-orm");

  const brand = await db.query.brands.findFirst({
    where: eq(brands.slug, brandSlug),
  });
  if (!brand) throw new Error(`No brand with slug "${brandSlug}".`);

  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ data: integrationRecords.data })
    .from(integrationRecords)
    .where(
      and(
        eq(integrationRecords.brandId, brand.id),
        eq(integrationRecords.recordType, "ad_insight"),
        gte(integrationRecords.periodStart, since),
      ),
    )
    .limit(5000);

  if (rows.length === 0) {
    console.log(`No stored ad rows for ${brand.name} since ${since}.`);
    return;
  }

  // Count how many rows carry each action type, and which top-level fields are
  // present at all — a field absent everywhere means the sync never asked.
  const typeCounts = new Map<string, number>();
  const fieldCounts = new Map<string, number>();
  for (const { data } of rows) {
    const row = data as Record<string, unknown>;
    for (const key of Object.keys(row)) {
      fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1);
    }
    const actions = (row.actions ?? []) as { action_type: string }[];
    for (const a of actions) {
      typeCounts.set(a.action_type, (typeCounts.get(a.action_type) ?? 0) + 1);
    }
  }

  console.log(`${brand.name}: ${rows.length} stored ad rows since ${since}\n`);

  console.log("What the mapper would use:");
  for (const [metric, candidates] of Object.entries(WANTED)) {
    const chosen = candidates.find((c) => typeCounts.has(c));
    const detail = chosen
      ? `${chosen} (${typeCounts.get(chosen)} rows)` +
        (chosen === candidates[0] ? "" : "  <- FALLBACK, not the preferred type")
      : "NOTHING MATCHES — this metric reads 0 everywhere";
    console.log(`  ${metric.padEnd(18)} ${detail}`);
  }

  const missingFields = [
    "outbound_clicks",
    "video_thruplay_watched_actions",
    "video_3_sec_watched_actions",
    "adset_id",
  ].filter((f) => !fieldCounts.has(f));
  if (missingFields.length) {
    console.log(
      `\nFields absent from every stored row: ${missingFields.join(", ")}` +
        "\nThese were added to the sync after this data was written. They fill " +
        "in on the next sync of the restatement window, and older days keep " +
        "reading 0 until a backfill covers them.",
    );
  }

  console.log("\nEvery action type present, by row count:");
  for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(6)}  ${type}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
