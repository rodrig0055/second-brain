"use client";

import { useState } from "react";
import type { TemplateInputField } from "@/db/schema";

/**
 * A dropdown that, when its "Other" option is chosen, reveals a free-text input so the operator can
 * type a value the dropdown doesn't list. Selects without an "Other" option behave exactly like a
 * plain <select>.
 *
 * This duplicates SelectField in components/task-runner.tsx, which is the shared runner other teams
 * depend on and which Custom Song deliberately does not use. The duplicate is the cheaper of the two
 * risks: collapse the two into one component the day the shared runner is ours to change.
 */
export function SelectWithOther({
  field,
  className,
  initialValue,
}: {
  field: TemplateInputField;
  className: string;
  /** A value being restored (a retry). Anything the dropdown doesn't list comes back as "Other". */
  initialValue?: string;
}) {
  const options = field.options ?? [];
  const hasOther = options.some((o) => o.toLowerCase() === "other");
  const restoredIsListed = !initialValue || options.includes(initialValue);
  const otherOption = options.find((o) => o.toLowerCase() === "other");

  const [value, setValue] = useState(
    restoredIsListed ? (initialValue ?? options[0] ?? "") : (otherOption ?? options[0] ?? ""),
  );
  const [other, setOther] = useState(restoredIsListed ? "" : (initialValue ?? ""));
  const isOther = hasOther && value.toLowerCase() === "other";

  return (
    <>
      <select
        // When "Other" is active the submitted value comes from the text input below, so the select
        // itself drops its name to avoid overwriting it.
        name={isOther ? undefined : field.name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required={field.required}
        className={className}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {isOther && (
        <input
          name={field.name}
          value={other}
          onChange={(e) => setOther(e.target.value)}
          required={field.required}
          placeholder={`Type the ${(field.label || field.name).toLowerCase()}`}
          className={className}
        />
      )}
    </>
  );
}
