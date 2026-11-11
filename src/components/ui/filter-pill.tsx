"use client";

import { useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import {
  DropdownMenu,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@astryxdesign/core/DropdownMenu";

/**
 * The filter row's one control: a pill that names what it is showing ("All
 * channels", "Last 28 days") and opens a menu to change it.
 *
 * A filter applies the moment you pick it. There is no Apply button, because a
 * button you have to remember to press is a filter that silently is not on.
 * Everything lands in the URL, so the view can be shared and survives a reload.
 *
 * It is an Astryx DropdownMenu, so the keyboard model is the menu's: Enter,
 * Space or ArrowDown opens it, the arrows and typeahead move, Enter picks,
 * Escape closes and focus returns to the pill. Rows go in `children`
 * (FilterChoices, DropdownMenuCheckboxItem); a control that is not a row, such
 * as a custom value, goes in `header` or `footer`, which turns the popover into
 * a small dialog that Tab cycles through.
 */
export function FilterPill({
  label,
  active = false,
  icon,
  children,
  header,
  footer,
  align = "start",
  width = 224,
  maxHeight,
}: {
  label: string;
  /** Set when the pill is narrowing the view, so it reads as on. */
  active?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  align?: "start" | "end";
  /** Minimum menu width in px. */
  width?: number;
  /** Lifts the menu's 300px height cap for long lists. */
  maxHeight?: number;
}) {
  const [open, setOpen] = useState(false);

  // A pick navigates; the menu should not still be open on the page it led to.
  // Reset during render when the URL changes, not in an effect.
  const pathname = usePathname();
  const params = useSearchParams();
  const urlKey = `${pathname}?${params.toString()}`;
  const [seenUrl, setSeenUrl] = useState(urlKey);
  if (urlKey !== seenUrl) {
    setSeenUrl(urlKey);
    setOpen(false);
  }

  return (
    <DropdownMenu
      isMenuOpen={open}
      onOpenChange={setOpen}
      alignment={align}
      menuWidth={width}
      menuMaxHeight={maxHeight}
      header={header}
      footer={footer}
      renderTrigger={(trigger) => (
        <Button
          {...trigger}
          label={label}
          size="sm"
          icon={icon}
          endContent={<Icon icon={ChevronDown} size="sm" color="secondary" />}
          className={active ? "bg-muted text-primary" : undefined}
        />
      )}
    >
      {children}
    </DropdownMenu>
  );
}

export type FilterChoice = {
  value: string;
  label: string;
  /** Where picking this choice goes. */
  href: string;
  /** Leading mark, e.g. a brand dot. */
  icon?: ReactNode;
  /** Trailing note, e.g. a currency or "in progress". */
  hint?: ReactNode;
};

/**
 * The single-choice rows of a pill, as menu radio items, so a screen reader
 * hears which one is on. Picking one navigates to its href without scrolling
 * the page, the way the old link rows did.
 */
export function FilterChoices({
  label,
  value,
  choices,
}: {
  /** Names the group for assistive tech, e.g. "Status". */
  label: string;
  value: string | undefined;
  choices: FilterChoice[];
}) {
  const navigate = useFilterNavigate();
  return (
    <DropdownMenuRadioGroup
      label={label}
      value={value}
      onChange={(next) => {
        const choice = choices.find((c) => c.value === next);
        if (choice) navigate(choice.href);
      }}
    >
      {choices.map((c) => (
        <DropdownMenuRadioItem
          key={c.value}
          value={c.value}
          label={
            c.icon ? (
              <HStack gap={2} vAlign="center">
                {c.icon}
                {c.label}
              </HStack>
            ) : (
              c.label
            )
          }
          endContent={
            c.hint ? (
              <Text type="supporting" color="secondary">
                {c.hint}
              </Text>
            ) : undefined
          }
        />
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** Client navigation for filters: same page, new query, keep the scroll position. */
export function useFilterNavigate() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return (href: string) => startTransition(() => router.push(href, { scroll: false }));
}

/**
 * A single-choice filter on one query key. With `allLabel`, the "all" option
 * removes the key, so the default view has a clean URL. Without it the key
 * always has a value, `defaultValue` when absent from the URL.
 */
export function QueryFilter({
  name,
  allLabel,
  defaultValue,
  prefix,
  options,
  icon,
  resets = [],
}: {
  name: string;
  allLabel?: string;
  defaultValue?: string;
  /** Leads the pill label: "A win is" + "ROAS ≥". */
  prefix?: string;
  options: { value: string; label: string; icon?: ReactNode }[];
  icon?: ReactNode;
  /** Keys that only make sense for the old value, dropped when this changes. */
  resets?: string[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get(name) ?? (allLabel ? "" : (defaultValue ?? ""));
  const chosen = options.find((o) => o.value === current);

  const href = (value: string) => {
    const q = new URLSearchParams(params.toString());
    if (value) q.set(name, value);
    else q.delete(name);
    if (value !== current) for (const key of resets) q.delete(key);
    const qs = q.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const choices: FilterChoice[] = [
    ...(allLabel ? [{ value: "", label: allLabel, href: href("") }] : []),
    ...options.map((o) => ({ value: o.value, label: o.label, icon: o.icon, href: href(o.value) })),
  ];

  const text = chosen?.label ?? allLabel ?? current;
  return (
    <FilterPill
      label={prefix ? `${prefix} ${text}` : text}
      active={allLabel ? Boolean(chosen) : false}
      icon={chosen?.icon ?? icon}
    >
      <FilterChoices label={prefix ?? allLabel ?? name} value={chosen ? current : ""} choices={choices} />
    </FilterPill>
  );
}
