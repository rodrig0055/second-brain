/**
 * Compares two Marketing API versions over the same closed window.
 *
 * Marketing API versions expire on a schedule, and once yours is gone Meta
 * silently answers on a newer one — so a sync that still works proves nothing
 * about which version is actually serving it, and a bump can therefore change
 * numbers without changing any of our code. This fetches the same window twice,
 * once per version, and diffs the rows. It writes nothing.
 *
 * Run it before and after changing DEFAULT_API_VERSION, and again when the next
 * version lapses (see the note in meta/client.ts).
 *
 *   set -a && . ./.env.local && set +a && \
 *     npx tsx scripts/check-meta-api-version.ts --brand acme-florals \
 *       --from 2026-08-25 --to 2026-08-31 --from-version v21.0
 *
 * Defaults: the newest connected Meta brand, the 7 days ending 14 days ago (far
 * enough back that attribution has settled, so a difference is the version's
 * doing and not late-arriving purchases), and DEFAULT_API_VERSION as the target.
 *
 * Reads stored connections, which needs INTEGRATIONS_ENC_KEY. Without it, set
 * ACCESS_TOKEN and AD_ACCOUNT_ID instead and those win — the only way to check
 * an ad account that has no connection row yet.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../src/db";
import { brands, integrationConnections } from "../src/db/schema";
import {
  DEFAULT_API_VERSION,
  extractConversions,
  fetchInsights,
  resolveMetaTarget,
  type InsightRow,
  type MetaTarget,
} from "../src/lib/integrations/meta/client";
import type { DbConnection } from "../src/lib/integrations/types";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** The fields a version change could plausibly move, per day. */
type Totals = {
  spend: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  reach: number;
  conversions: number;
  conversionValue: number;
};

function totalsOf(row: InsightRow): Totals {
  const { conversions, conversionValue } = extractConversions(row);
  return {
    spend: Number(row.spend ?? 0),
    impressions: Number(row.impressions ?? 0),
    clicks: Number(row.clicks ?? 0),
    linkClicks: Number(row.inline_link_clicks ?? 0),
    reach: Number(row.reach ?? 0),
    conversions,
    conversionValue,
  };
}

const FIELDS = [
  "spend",
  "impressions",
  "clicks",
  "linkClicks",
  "reach",
  "conversions",
  "conversionValue",
] as const;

/**
 * Campaign level returns one row per campaign per day, so the key has to carry
 * the entity too — keying on the date alone would keep only the last campaign
 * of each day and quietly compare two single campaigns.
 */
function indexRows(rows: InsightRow[]): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const row of rows) {
    const key = row.campaign_id
      ? `${row.campaign_id} ${row.date_start}`
      : row.date_start;
    out.set(key, totalsOf(row));
  }
  return out;
}

/**
 * Money and rates are floats; an exact === would flag noise as a regression.
 * A cent (or one whole impression) is below anything we would act on.
 */
function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > 0.01;
}

/** One account to compare, however its token was obtained. */
type Subject = { label: string; base: MetaTarget };

/**
 * Stored connections need INTEGRATIONS_ENC_KEY to decrypt, which a machine that
 * only ever runs the app against production may not hold. ACCESS_TOKEN and
 * AD_ACCOUNT_ID are the escape hatch, and the only route for an account that has
 * no connection row yet — an ad account being onboarded is exactly that.
 */
async function subjects(brandSlug?: string): Promise<Subject[]> {
  const envToken = process.env.ACCESS_TOKEN?.trim();
  const envAccount = process.env.AD_ACCOUNT_ID?.trim();
  if (envToken && envAccount) {
    return [
      {
        label: envAccount,
        base: {
          accountId: envAccount.startsWith("act_")
            ? envAccount
            : `act_${envAccount}`,
          apiVersion: DEFAULT_API_VERSION,
          accessToken: envToken,
        },
      },
    ];
  }

  const rows = await db
    .select({ conn: integrationConnections, slug: brands.slug })
    .from(integrationConnections)
    .innerJoin(brands, eq(brands.id, integrationConnections.brandId))
    .where(
      brandSlug
        ? and(
            eq(integrationConnections.platform, "meta"),
            eq(brands.slug, brandSlug),
          )
        : eq(integrationConnections.platform, "meta"),
    );

  if (rows.length === 0) {
    throw new Error(
      brandSlug
        ? `No Meta connection for brand "${brandSlug}".`
        : "No Meta connections at all.",
    );
  }

  return rows.map(({ conn, slug }) => {
    try {
      return { label: slug, base: resolveMetaTarget(conn as DbConnection) };
    } catch (err) {
      // The bare "INTEGRATIONS_ENC_KEY is not set" from crypto.ts names one of
      // the two ways to run this and leaves you guessing about the other.
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Cannot read the stored token for ${slug}: ${detail}\n` +
          "Either set INTEGRATIONS_ENC_KEY (the key the credentials were " +
          "encrypted with, not a fresh one), or skip the stored connection " +
          "entirely by setting ACCESS_TOKEN and AD_ACCOUNT_ID.",
      );
    }
  });
}

async function main() {
  const brandSlug = arg("brand");
  const toVersion = arg("to-version") ?? DEFAULT_API_VERSION;
  const fromVersion = arg("from-version") ?? "v21.0";
  const end = arg("to") ?? isoDaysAgo(14);
  const start = arg("from") ?? isoDaysAgo(20);

  const accounts = await subjects(brandSlug);

  console.log(
    `Comparing ${fromVersion} → ${toVersion} over ${start}..${end}\n`,
  );

  for (const { label: slug, base } of accounts) {
    const targets: Record<string, MetaTarget> = {
      [fromVersion]: { ...base, apiVersion: fromVersion },
      [toVersion]: { ...base, apiVersion: toVersion },
    };

    for (const level of ["account", "campaign"] as const) {
      // Sequential on purpose: the two calls are the same query against the same
      // account, and running them together invites a rate-limit error that would
      // read as a version difference.
      const before = indexRows(
        await fetchInsights(targets[fromVersion], level, start, end),
      );
      const after = indexRows(
        await fetchInsights(targets[toVersion], level, start, end),
      );

      const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
      let mismatches = 0;

      for (const key of keys) {
        const a = before.get(key);
        const b = after.get(key);
        if (!a || !b) {
          console.log(
            `FAIL  ${slug} ${level} ${key}: present in ${a ? fromVersion : toVersion} only`,
          );
          mismatches++;
          continue;
        }
        for (const field of FIELDS) {
          if (differs(a[field], b[field])) {
            console.log(
              `FAIL  ${slug} ${level} ${key} ${field}: ${a[field]} → ${b[field]}`,
            );
            mismatches++;
          }
        }
      }

      if (mismatches > 0) process.exitCode = 1;
      console.log(
        `${mismatches === 0 ? "PASS" : "FAIL"}  ${slug} ${level}: ` +
          `${keys.length} rows, ${mismatches} mismatches`,
      );
    }
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((e) => {
    console.error("✗", e.message);
    process.exit(1);
  });
