"use client";

import { useOptimistic, useTransition } from "react";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { DropdownMenuCheckboxItem, DropdownMenuDivider } from "@astryxdesign/core/DropdownMenu";

import { setBrandScope } from "@/app/(app)/t/[team]/scope-actions";
import { brandTone } from "@/lib/brand-tone";
import { encodeScopeValue, toggleSlug, type ScopeSelection } from "@/lib/brand-scope-params";
import { FilterPill } from "@/components/ui/filter-pill";

export type ScopeBadge = { label: string; tone?: "neutral" | "warn" | "alert" | "good" };

type MenuBrand = { id: string; slug: string; name: string };

/**
 * The brand scope menu: one checkbox row per brand, plus "All brands" where the
 * workspace allows it. Each toggle runs the scope server action, because the
 * choice also writes the cookie that makes it stick across visits, and only a
 * server action can set one. The menu stays open, so several brands can be
 * toggled in one go; the ticks move at once and the page catches up.
 */
export function BrandFilterMenu({
  teamSlug,
  returnTo,
  allowAll,
  brands,
  selection,
  badges,
}: {
  teamSlug: string;
  returnTo: string;
  allowAll: boolean;
  brands: MenuBrand[];
  selection: ScopeSelection;
  badges?: Record<string, ScopeBadge[]>;
}) {
  const [shown, setShown] = useOptimistic(selection);
  const [, startTransition] = useTransition();

  const isAll = shown.all;
  const selected = shown.all ? [] : brands.filter((b) => shown.slugs.includes(b.slug));
  const allSlugs = brands.map((b) => b.slug);
  const waiting = Object.values(badges ?? {}).flat().length;

  const label = isAll
    ? "All brands"
    : selected.length === 1
      ? selected[0].name
      : `${selected.length} brands`;
  const dot = !isAll && selected.length === 1 ? brandTone(selected[0].slug).dot : null;

  function choose(next: ScopeSelection) {
    const form = new FormData();
    form.set("teamSlug", teamSlug);
    form.set("returnTo", returnTo);
    form.set("brands", next.all ? "all" : encodeScopeValue(next));
    startTransition(async () => {
      setShown(next);
      await setBrandScope(form);
    });
  }

  return (
    <FilterPill
      label={label}
      active={!isAll}
      icon={dot ? <Dot className={dot} /> : undefined}
    >
      {allowAll && (
        <DropdownMenuCheckboxItem
          label="All brands"
          value={isAll}
          onChange={() => {
            if (!isAll) choose({ all: true });
          }}
          endContent={waiting > 0 ? <Waiting>{`${waiting} waiting`}</Waiting> : undefined}
        />
      )}
      {allowAll && <DropdownMenuDivider />}
      {brands.map((brand) => {
        const on = !isAll && shown.slugs.includes(brand.slug);
        const isLastOn = on && selected.length === 1;
        const next: ScopeSelection = isAll
          ? { all: false, slugs: [brand.slug] }
          : toggleSlug(shown, brand.slug, allSlugs, "multi");
        const badge = badges?.[brand.slug]?.[0];
        return (
          <DropdownMenuCheckboxItem
            key={brand.id}
            label={
              <HStack gap={2} vAlign="center">
                <Dot className={brandTone(brand.slug).dot} />
                {brand.name}
              </HStack>
            }
            description={isLastOn ? "At least one brand stays selected" : undefined}
            value={on}
            isDisabled={isLastOn}
            onChange={() => choose(next)}
            endContent={badge ? <Waiting>{badge.label}</Waiting> : undefined}
          />
        );
      })}
    </FilterPill>
  );
}

function Dot({ className }: { className: string }) {
  return <span aria-hidden className={`size-2 shrink-0 rounded-full ${className}`} />;
}

function Waiting({ children }: { children: string }) {
  return (
    <Text type="supporting" className="text-amber-700">
      {children}
    </Text>
  );
}
