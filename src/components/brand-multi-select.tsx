"use client";

import { useState } from "react";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";

type Brand = { id: string; name: string };

/**
 * Multi-select for scoping a row to brands. Submits each selected id as a
 * hidden input named `name`, so the server action reads them with
 * formData.getAll("brandIds"). No selection = empty = applies to all brands.
 *
 * The visible label stays with the caller's form row; this one names the
 * control for assistive tech.
 */
export function BrandMultiSelect({
  brands,
  selected = [],
  name = "brandIds",
  label = "Applies to brands",
}: {
  brands: Brand[];
  selected?: string[];
  name?: string;
  label?: string;
}) {
  const [chosen, setChosen] = useState<string[]>(selected);

  return (
    <MultiSelector
      label={label}
      isLabelHidden
      htmlName={name}
      options={brands.map((b) => ({ value: b.id, label: b.name }))}
      value={chosen}
      onChange={setChosen}
      placeholder="All brands (global)"
      triggerDisplay="labels"
      formatValue={(items) =>
        items.length === brands.length && brands.length > 0
          ? "All brands"
          : items.map((i) => i.label).join(", ")
      }
      hasSelectAll
      hasClear
      width="100%"
    />
  );
}
