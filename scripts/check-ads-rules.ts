/**
 * Runs the kill rules over an account and prints what they would flag.
 *
 *   npm run check:ads:rules -- --brand acme-florals [--write]
 *
 * Without --write nothing is stored: it evaluates, prints, and exits. That is
 * the mode to use when reviewing thresholds with whoever owns the account,
 * because the whole point is to compare the rules' verdict against theirs
 * before any of it starts proposing that ads be turned off.
 *
 * Reads stored rows only, so no Meta credentials are needed.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const brandSlug = arg("brand") ?? "acme-florals";
  const write = process.argv.includes("--write");

  const { db } = await import("../src/db");
  const { brands, integrationConnections } = await import("../src/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const { loadRules, runRules, weeklyCpa } = await import(
    "../src/lib/ads/rules/run"
  );
  const { evaluateSubject } = await import("../src/lib/ads/rules/evaluate");

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

  const stored = await loadRules(connection.id);
  const cpa = await weeklyCpa(connection);

  // With nothing stored, preview against the seeded benchmarks rather than
  // reporting "no rules". Being able to try thresholds on real numbers before
  // committing them to an account is the point of the dry mode.
  const usingDefaults = stored.length === 0 && !write;
  const { DEFAULT_RULES } = await import("../src/lib/ads/rules/defaults");
  const rules = usingDefaults
    ? DEFAULT_RULES.map((r) => ({
        key: r.key,
        kind: r.kind,
        enabled: true,
        currency,
        level: r.level,
        funnels: r.funnels as never,
        includeEventAdSets: r.includeEventAdSets,
        params: r.params,
        confirmed: false,
      }))
    : stored;
  if (usingDefaults) {
    console.log("(no rules stored for this account — previewing the defaults)");
  }

  console.log(`${brand.name} · ${currency}`);
  console.log(
    `${rules.length} rules, ${rules.filter((r) => r.enabled).length} enabled, ` +
      `${rules.filter((r) => r.confirmed).length} confirmed for this brand`,
  );
  console.log(
    cpa === null
      ? "No purchases in the settled week, so the 3x rule cannot run.\n"
      : `Week's cost per purchase: ${currency} ${cpa.toFixed(2)} (3x = ${(cpa * 3).toFixed(2)})\n`,
  );

  if (rules.length === 0) {
    console.log(
      "Nothing to run. Seed the thresholds first:\n" +
        `  npx tsx scripts/seed-bloomly-ph-ads.ts --brand ${brandSlug}`,
    );
    return;
  }

  if (!write) {
    // Re-evaluate without touching the alert table, by borrowing the same
    // subject builder runRules uses. Deliberately a dry read: reviewing
    // thresholds should not fill someone's alert list with the attempt.
    const { loadPivot } = await import("../src/lib/ads/store");
    const rows = await loadPivot({
      connectionId: connection.id,
      brandId: brand.id,
      level: "ad",
      range: {
        start: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
        end: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      },
      currency,
    });

    let flagged = 0;
    for (const row of rows) {
      const findings = evaluateSubject(
        rules,
        {
          level: "ad",
          id: row.id,
          name: row.name,
          funnel: row.funnel,
          isEventAdSet: row.isEventAdSet,
          status: row.status,
          currency,
          daysActive: row.daysActive,
          settled: row.totals,
          live: row.totals,
          frequency: {
            value: row.reach.frequency,
            exact: row.reach.exact,
          },
        },
        { weeklyCpa: cpa, currency, now: new Date() },
      );
      if (findings.length === 0) continue;
      flagged++;
      console.log(`${row.name}`);
      console.log(
        `  ${currency} ${row.totals.spend.toFixed(2)} · ` +
          `${row.totals.purchases} purchases · ` +
          `CIR ${row.totals.purchaseValue > 0 ? `${row.totals.cir.toFixed(0)}%` : "n/a"} · ` +
          `${row.funnel ?? "unmapped"}`,
      );
      for (const f of findings) {
        console.log(
          `  ${f.severity === "critical" ? "KILL " : "WATCH"} ${f.ruleKey.padEnd(22)} ${f.message}` +
            `${f.provisional ? " [provisional]" : ""}` +
            `${f.confirmed ? "" : " [threshold not confirmed for this brand]"}`,
        );
      }
      console.log("");
    }
    console.log(
      `${flagged} of ${rows.length} ads flagged. Nothing written — pass --write to store alerts.`,
    );
    // The whole window is treated as settled in this dry mode, so purchases
    // inside the restatement period count. The stored run is stricter.
    console.log(
      "Note: this dry run judges the full 30 days as settled. The real run " +
        "excludes the last 8, so it flags less, not more.",
    );
    return;
  }

  const result = await runRules(connection, currency);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
