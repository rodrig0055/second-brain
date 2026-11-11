import "server-only";

import { cookies } from "next/headers";
import { and, inArray, ne } from "drizzle-orm";

import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { getUserBrands, type DbBrand, type DbUser } from "@/lib/access";
import type { DbConnection } from "@/lib/integrations/types";
import {
  applySelection,
  encodeScopeValue,
  scopeCookieName,
  selectionFromSearchParams,
  parseScopeValue,
  type ScopeSelection,
  type SearchParamsLike,
} from "@/lib/brand-scope-params";
import { workspaceFor, type IntegrationPlatform } from "@/lib/workspaces";

/**
 * Which brands a channel workspace is looking at.
 *
 * A specialist runs several brands at once: a social specialist has Instagram and Facebook
 * for four of them. Every surface before this picked one brand per page, from a
 * param that nothing remembered, so moving between pages silently reset to the
 * alphabetically-first brand.
 *
 * Precedence is URL, then cookie, then default. The URL has to win or a shared
 * link would show the recipient their own last selection instead of what the
 * sender saw. The cookie only fills in when the URL says nothing, which is what
 * makes the scope survive a plain click on a nav pill.
 *
 * Writing the cookie happens in one place, the `setBrandScope` server action:
 * `cookies().set` is only legal in a server function or route handler, never
 * during render.
 */

export type BrandScope = {
  /** Accessible brands that actually have a connection for this workspace. */
  all: DbBrand[];
  selected: DbBrand[];
  isAll: boolean;
  /** Canonical `brands=` value, for links. */
  param: string;
  source: "url" | "cookie" | "default" | "single";
  /** Connections per brand id, so callers do not re-query for the ad account. */
  connections: Map<string, DbConnection[]>;
  teamSlug: string;
  allowAll: boolean;
};

/**
 * Accessible brands that have a live connection on one of `platforms`.
 * `disconnected` is excluded but `error` is kept: a brand whose token expired
 * should still appear, so the surface can say so rather than hiding the brand.
 */
export async function brandsWithConnections(
  user: DbUser,
  platforms: IntegrationPlatform[],
): Promise<{ brands: DbBrand[]; connections: Map<string, DbConnection[]> }> {
  const accessible = await getUserBrands(user);
  if (accessible.length === 0 || platforms.length === 0) {
    return { brands: [], connections: new Map() };
  }

  const rows = await db.query.integrationConnections.findMany({
    where: and(
      inArray(
        integrationConnections.brandId,
        accessible.map((b) => b.id),
      ),
      inArray(integrationConnections.platform, platforms),
      ne(integrationConnections.status, "disconnected"),
    ),
  });

  const connections = new Map<string, DbConnection[]>();
  for (const row of rows) {
    const list = connections.get(row.brandId) ?? [];
    list.push(row);
    connections.set(row.brandId, list);
  }

  return {
    brands: accessible.filter((b) => connections.has(b.id)),
    connections,
  };
}

export async function readBrandScopeCookie(teamSlug: string): Promise<ScopeSelection | null> {
  try {
    const store = await cookies();
    return parseScopeValue(store.get(scopeCookieName(teamSlug))?.value);
  } catch {
    // There is no cookie outside a request: a script, a background pass, or a
    // context Next has not given a request store. The saved scope is a
    // convenience, so its absence falls through to the default rather than
    // taking the caller down.
    return null;
  }
}

export async function resolveBrandScope(opts: {
  user: DbUser;
  teamSlug: string;
  platforms?: IntegrationPlatform[];
  searchParams: SearchParamsLike;
  /** False where a surface can only render one brand at a time. */
  allowAll?: boolean;
}): Promise<BrandScope> {
  const { user, teamSlug, searchParams, allowAll = true } = opts;
  const platforms = opts.platforms ?? workspaceFor(teamSlug).scopePlatforms ?? [];
  const { brands: all, connections } = await brandsWithConnections(user, platforms);

  const base = { all, connections, teamSlug, allowAll };

  if (all.length === 0) {
    return { ...base, selected: [], isAll: false, param: "", source: "default" };
  }

  // One brand is not a choice. No chips, no cookie, no param.
  if (all.length === 1) {
    return { ...base, selected: all, isAll: !allowAll ? false : true, param: all[0].slug, source: "single" };
  }

  const fromUrl = selectionFromSearchParams(searchParams, all);
  const urlPick = fromUrl ? applySelection(all, fromUrl, allowAll) : null;
  if (urlPick?.length) {
    return { ...base, ...describe(urlPick, all, allowAll), source: "url" };
  }

  const fromCookie = await readBrandScopeCookie(teamSlug);
  const cookiePick = fromCookie ? applySelection(all, fromCookie, allowAll) : null;
  if (cookiePick?.length) {
    return { ...base, ...describe(cookiePick, all, allowAll), source: "cookie" };
  }

  const fallback = allowAll ? all : all.slice(0, 1);
  return { ...base, ...describe(fallback, all, allowAll), source: "default" };
}

function describe(
  selected: DbBrand[],
  all: DbBrand[],
  allowAll: boolean,
): { selected: DbBrand[]; isAll: boolean; param: string } {
  const isAll = allowAll && selected.length === all.length;
  return {
    selected,
    isAll,
    param: encodeScopeValue(
      isAll ? { all: true } : { all: false, slugs: selected.map((b) => b.slug) },
    ),
  };
}

/**
 * A brand id from a form field, checked against this workspace's eligible
 * brands. Server actions never trust the brand the form names.
 */
export async function requireScopedBrand(
  user: DbUser,
  teamSlug: string,
  brandId: string,
): Promise<DbBrand | null> {
  const platforms = workspaceFor(teamSlug).scopePlatforms ?? [];
  const { brands } = await brandsWithConnections(user, platforms);
  return brands.find((b) => b.id === brandId) ?? null;
}

/** Append this scope to a link. */
export function withBrandScope(href: string, scope: BrandScope): string {
  if (!scope.param) return href;
  const [path, existing] = href.split("?");
  const q = new URLSearchParams(existing ?? "");
  q.set("brands", scope.param);
  return `${path}?${q.toString()}`;
}
