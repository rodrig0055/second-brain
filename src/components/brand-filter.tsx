import { brandTone } from "@/lib/brand-tone";
import type { BrandScope } from "@/lib/brand-scope";
import { withQuery, type ScopeSelection } from "@/lib/brand-scope-params";
import { BrandFilterMenu, type ScopeBadge } from "@/components/brand-filter-menu";

export type { ScopeBadge };

/**
 * The brand scope as a filter pill: "All brands", "Bloomly PH", or "3 brands".
 *
 * A server component on purpose: the scope carries each brand's connections,
 * which must never reach the browser, so only ids, slugs and names cross to
 * the client menu.
 */
export function BrandFilter({
  scope,
  pathname,
  query = {},
  badges,
}: {
  scope: BrandScope;
  pathname: string;
  query?: Record<string, string>;
  badges?: Record<string, ScopeBadge[]>;
}) {
  const { all, selected, isAll } = scope;
  if (all.length === 0) return null;

  // One brand is not a choice: show it, do not ask.
  if (all.length === 1) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-primary">
        <span className={`size-2 rounded-full ${brandTone(all[0].slug).dot}`} />
        {all[0].name}
      </span>
    );
  }

  const selection: ScopeSelection = isAll
    ? { all: true }
    : { all: false, slugs: selected.map((b) => b.slug) };

  return (
    <BrandFilterMenu
      teamSlug={scope.teamSlug}
      returnTo={withQuery(pathname, query, { brands: null, brand: null })}
      allowAll={scope.allowAll}
      brands={all.map((b) => ({ id: b.id, slug: b.slug, name: b.name }))}
      selection={selection}
      badges={badges}
    />
  );
}
