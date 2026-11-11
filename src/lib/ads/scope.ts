import "server-only";

import type { DbBrand, DbUser } from "@/lib/access";
import { resolveBrandScope, type BrandScope } from "@/lib/brand-scope";
import type { SearchParamsLike } from "@/lib/date-range";
import {
  loadAccountClaims,
  writeGateFor,
} from "@/lib/ads/actions/executor";
import type { AccountClaim } from "@/lib/ads/actions/account-guard";
import { META_ADS_TEAM_SLUG } from "@/lib/workspaces";
import type { DbConnection } from "@/lib/integrations/types";

/**
 * The ad accounts a specialist is looking at.
 *
 * One connection per brand: a brand has one Meta ad account, and the account is
 * the connection row. Currency travels with each account and is never converted
 * — there is no FX anywhere in this app, so a total across a PHP and a USD
 * account would be a number nobody could act on.
 */

export type MetaScopeBrand = {
  brand: DbBrand;
  connection: DbConnection;
  currency: string;
  adAccountId: string;
  timezone: string;
  /** Whether this account will accept a change from here, and why not. */
  writeGate: { ok: boolean; reason: string };
};

export type MetaScope = {
  all: MetaScopeBrand[];
  selected: MetaScopeBrand[];
  isAll: boolean;
  param: string;
  /** Distinct currencies in the selection. More than one means no totals. */
  currencies: string[];
  raw: BrandScope;
};

function decorate(
  brand: DbBrand,
  connection: DbConnection,
  claims: AccountClaim[],
): MetaScopeBrand {
  return {
    brand,
    connection,
    currency: String(connection.config?.currency ?? "USD"),
    adAccountId: String(connection.config?.adAccountId ?? connection.externalAccountId ?? ""),
    timezone: String(connection.config?.timezone ?? "UTC"),
    writeGate: writeGateFor(connection, claims),
  };
}

export async function resolveMetaScope(
  user: DbUser,
  searchParams: SearchParamsLike,
): Promise<MetaScope> {
  const [raw, claims] = await Promise.all([
    resolveBrandScope({
      user,
      teamSlug: META_ADS_TEAM_SLUG,
      platforms: ["meta"],
      searchParams,
    }),
    // Once for the whole scope, not once per brand: the gate needs every
    // brand's claim to answer for any one of them.
    loadAccountClaims(),
  ]);

  const pick = (brands: DbBrand[]): MetaScopeBrand[] =>
    brands.flatMap((brand) => {
      const conns = raw.connections.get(brand.id) ?? [];
      // Oldest first, so a brand that somehow has two accounts is stable rather
      // than flipping between them run to run.
      const conn = [...conns].sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      )[0];
      return conn ? [decorate(brand, conn, claims)] : [];
    });

  const selected = pick(raw.selected);

  return {
    all: pick(raw.all),
    selected,
    isAll: raw.isAll,
    param: raw.param,
    currencies: [...new Set(selected.map((s) => s.currency))],
    raw,
  };
}

/** One account, by brand id, for a server action that names a brand. */
export async function metaConnectionFor(
  user: DbUser,
  brandId: string,
): Promise<MetaScopeBrand | null> {
  const scope = await resolveMetaScope(user, { brands: "all" });
  return scope.all.find((s) => s.brand.id === brandId) ?? null;
}
