/**
 * Reads the cockpit's numbers out of stored data and checks they add up.
 *
 *   npx tsx scripts/check-ads-store.ts [--brand acme-florals] [--days 7] [--level ad]
 *
 * The check that matters is the last one: the per-entity rows are summed and
 * compared against the account's own daily totals, which the sync wrote from a
 * separate Meta call. They come from different requests, so agreement is real
 * evidence the grouping, the action-type picking and the date filtering are all
 * right, rather than a tautology.
 *
 * Reads only the database. Needs no Meta credentials.
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

function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const brandSlug = arg("brand") ?? "acme-florals";
  const days = Number(arg("days") ?? 7);
  const level = (arg("level") ?? "ad") as "campaign" | "adset" | "ad";
  // End a day back: today is partial and would not match a settled comparison.
  const range = { start: ymd(days + 1), end: ymd(1) };

  const { db } = await import("../src/db");
  const { brands, integrationConnections, metricsDaily } = await import(
    "../src/db/schema"
  );
  const { and, eq, gte, lte } = await import("drizzle-orm");
  const { loadPivot, loadDailyTracker } = await import("../src/lib/ads/store");

  const brand = await db.query.brands.findFirst({
    where: eq(brands.slug, brandSlug),
  });
  if (!brand) throw new Error(`No brand "${brandSlug}".`);
  const connection = await db.query.integrationConnections.findFirst({
    where: and(
      eq(integrationConnections.brandId, brand.id),
      eq(integrationConnections.platform, "meta"),
    ),
  });
  if (!connection) throw new Error(`${brand.name} has no Meta connection.`);
  const currency = String(connection.config?.currency ?? "USD");

  console.log(`${brand.name} · ${level} level · ${range.start}..${range.end}\n`);

  const rows = await loadPivot({
    connectionId: connection.id,
    brandId: brand.id,
    level,
    range,
    currency,
  });

  if (rows.length === 0) {
    console.log("No rows. Nothing has synced at this level for this window yet.");
    return;
  }

  console.log(
    "spend".padStart(9),
    "CIR".padStart(8),
    "purch".padStart(6),
    "CTR".padStart(7),
    "LPVr".padStart(7),
    "warm".padStart(6),
    "days".padStart(5),
    " funnel  name",
  );
  for (const row of rows.slice(0, 12)) {
    const t = row.totals;
    console.log(
      t.spend.toFixed(2).padStart(9),
      (t.cir ? `${t.cir.toFixed(0)}%` : "-").padStart(8),
      String(t.purchases).padStart(6),
      (t.ctr ? `${t.ctr.toFixed(2)}%` : "-").padStart(7),
      (t.lpvr ? `${t.lpvr.toFixed(0)}%` : "-").padStart(7),
      String(t.warm).padStart(6),
      String(row.daysActive).padStart(5),
      ` ${(row.funnel ?? "—").padEnd(7)} ${row.name.slice(0, 44)}`,
    );
  }
  if (rows.length > 12) console.log(`  … ${rows.length - 12} more`);

  // --- the reconciliation ---
  const summed = rows.reduce(
    (acc, r) => ({
      spend: acc.spend + r.totals.spend,
      impressions: acc.impressions + r.totals.impressions,
      purchases: acc.purchases + r.totals.purchases,
    }),
    { spend: 0, impressions: 0, purchases: 0 },
  );

  const accountRows = await db
    .select()
    .from(metricsDaily)
    .where(
      and(
        eq(metricsDaily.brandId, brand.id),
        eq(metricsDaily.platform, "meta"),
        eq(metricsDaily.dimensionKey, ""),
        gte(metricsDaily.date, range.start),
        lte(metricsDaily.date, range.end),
      ),
    );
  const account = accountRows.reduce(
    (acc, r) => ({
      spend: acc.spend + Number(r.spend),
      impressions: acc.impressions + r.impressions,
      purchases: acc.purchases + r.conversions,
    }),
    { spend: 0, impressions: 0, purchases: 0 },
  );

  console.log("");
  console.log(
    `  ${level} rows:  ${summed.spend.toFixed(2)} spend, ` +
      `${summed.impressions} impressions, ${summed.purchases} purchases`,
  );
  console.log(
    `  account:   ${account.spend.toFixed(2)} spend, ` +
      `${account.impressions} impressions, ${account.purchases} purchases`,
  );

  // Within 1%: entity-level and account-level come from separate Meta calls
  // and a few cents of rounding per day is expected. A large gap is not.
  const drift = account.spend > 0
    ? Math.abs(summed.spend - account.spend) / account.spend
    : 0;
  check(
    `${level}-level spend reconciles with the account total`,
    drift < 0.01,
    `${(drift * 100).toFixed(2)}% apart`,
  );

  // --- tracker ---
  const tracker = await loadDailyTracker({
    connectionId: connection.id,
    brandId: brand.id,
    range,
  });
  const totalRows = tracker.filter((r) => r.funnel === "TOTAL");
  const unmapped = tracker.filter((r) => r.funnel === "UNMAPPED");
  check(
    "the tracker has a TOTAL row per synced day",
    totalRows.length === accountRows.length,
    `${totalRows.length} of ${accountRows.length}`,
  );
  if (unmapped.length) {
    const spend = unmapped.reduce((s, r) => s + r.totals.spend, 0);
    console.log(
      `NOTE  ${unmapped.length} day(s) carry unmapped ad set spend ` +
        `(${spend.toFixed(2)} ${currency}). Annotate those ad sets or their ` +
        "spend sits outside every funnel total.",
    );
  }
  const funnelRows = tracker.filter(
    (r) => r.funnel !== "TOTAL" && r.funnel !== "UNMAPPED",
  );
  if (funnelRows.length === 0) {
    console.log(
      "NOTE  No funnel rows: ad-set level has not synced yet, so the tracker " +
        "can only show account totals.",
    );
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
