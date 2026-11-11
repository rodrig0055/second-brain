/**
 * Pull each brand's account configuration and show what came back.
 *
 *   npm run check:ads:entities                     # every connected brand
 *   npm run check:ads:entities -- --brand Bloomly PH
 *
 * This is the only thing in the repo that reads Meta's `/campaigns`, `/adsets`
 * and `/ads` edges, so it is how the entity model gets proven against a real
 * account rather than against fixtures.
 *
 * Needs INTEGRATIONS_ENC_KEY, because the ad account token is encrypted at
 * rest. Without it this cannot run at all, and says so rather than failing
 * somewhere further in.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  // Asked of the crypto module rather than of one variable name: after a
  // rotation the live key may be INTEGRATIONS_ENC_KEY_NEXT, and refusing then
  // would be refusing over a spelling.
  const { encryptionConfigured } = await import("@/lib/crypto");
  if (!encryptionConfigured()) {
    console.error(
      "No encryption key is set, so the stored ad account token cannot be\n" +
        "decrypted and no Meta call can be made.\n\n" +
        "Add the current key to .env.local as INTEGRATIONS_ENC_KEY (or\n" +
        "INTEGRATIONS_ENC_KEY_NEXT, whichever Vercel is writing with):\n\n" +
        "  INTEGRATIONS_ENC_KEY=<the key>\n",
    );
    process.exit(2);
  }

  const wanted = arg("brand");

  const { db } = await import("@/db");
  const S = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const { syncMetaEntities, entityFreshness } = await import(
    "@/lib/integrations/meta/entity-sync"
  );
  const { fromMinorUnits } = await import("@/lib/integrations/meta/entities");

  const conns = await db
    .select({
      conn: S.integrationConnections,
      brandName: S.brands.name,
    })
    .from(S.integrationConnections)
    .innerJoin(S.brands, eq(S.brands.id, S.integrationConnections.brandId))
    .where(eq(S.integrationConnections.platform, "meta"));

  const targets = wanted
    ? conns.filter((c) => c.brandName.toLowerCase() === wanted.toLowerCase())
    : conns;

  if (targets.length === 0) {
    console.error(`No Meta connection for "${wanted ?? "any brand"}".`);
    process.exit(2);
  }

  for (const { conn, brandName } of targets) {
    console.log(`\n=== ${brandName} ===`);
    try {
      const result = await syncMetaEntities(conn as never);
      console.log(
        `${result.adAccountId}: ` +
          `${result.counts.campaign} campaigns, ` +
          `${result.counts.adset} ad sets, ` +
          `${result.counts.ad} ads`,
      );
      if (result.vanished > 0) {
        console.log(`${result.vanished} stored entities no longer returned.`);
      }
      if (result.changed.length > 0) {
        console.log(
          `changed since last sync: ${result.changed.slice(0, 10).join(", ")}` +
            (result.changed.length > 10 ? ` (+${result.changed.length - 10})` : ""),
        );
      }

      const currency = String(conn.config?.currency ?? "USD");
      // No limit: where the budget sits is the question, and a capped sample
      // answers it wrongly by whatever the cap happened to include.
      const sets = await db
        .select()
        .from(S.adEntities)
        .where(eq(S.adEntities.connectionId, conn.id));

      const withBudget = sets.filter(
        (r) => r.dailyBudgetMinor || r.lifetimeBudgetMinor,
      );

      // The decision this check exists to settle: under campaign budget
      // optimisation the money sits on the campaign, and a budget proposal has
      // to target the campaign rather than the ad set.
      const byLevel = (level: string) => ({
        total: sets.filter((r) => r.level === level).length,
        budgeted: withBudget.filter((r) => r.level === level).length,
      });
      console.log("\nWhere the budget sits:");
      for (const level of ["campaign", "adset", "ad"]) {
        const { total, budgeted } = byLevel(level);
        if (total === 0) continue;
        console.log(`  ${level.padEnd(9)} ${String(budgeted).padStart(4)} of ${total} carry one`);
      }
      const camp = byLevel("campaign");
      const adset = byLevel("adset");
      console.log(
        camp.budgeted > 0 && adset.budgeted === 0
          ? "  -> campaign budget optimisation throughout: propose against campaigns."
          : adset.budgeted > 0 && camp.budgeted === 0
            ? "  -> ad-set budgets throughout: propose against ad sets."
            : "  -> MIXED. A budget proposal must read the entity before choosing a level.",
      );
      console.log(
        `\n${withBudget.length} of ${sets.length} entities carry a budget.`,
      );
      for (const row of withBudget.slice(0, 8)) {
        const daily = fromMinorUnits(row.dailyBudgetMinor, currency);
        const life = fromMinorUnits(row.lifetimeBudgetMinor, currency);
        console.log(
          `  ${row.level.padEnd(8)} ${row.status.padEnd(9)} ` +
            (daily !== null ? `${currency} ${daily}/day  ` : "") +
            (life !== null ? `${currency} ${life} lifetime  ` : "") +
            row.name.slice(0, 44),
        );
      }

      const targeted = sets.filter((r) => r.targetingHash);
      console.log(`\n${targeted.length} ad sets carry a targeting spec.`);
      const age = await entityFreshness(conn.id);
      console.log(`mirror age: ${age} minute(s)`);
    } catch (err) {
      console.error(`  failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
