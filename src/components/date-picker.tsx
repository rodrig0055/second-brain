"use client";

import { useState } from "react";
import { DateInput } from "@astryxdesign/core/DateInput";
import type { ISODateString } from "@astryxdesign/core/Calendar";
import type { TemplateInputField } from "@/db/schema";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A calendar date field for template inputs. Astryx DateInput (typed entry, a
 * calendar popover on a laptop, the native picker on a phone) writing an ISO
 * "YYYY-MM-DD" string into a hidden input named `name`, so it submits with the
 * surrounding form exactly like a plain text input would.
 *
 * The visible label stays with the caller's form row; `label` names the
 * control for assistive tech.
 */
export function DatePicker({
  name,
  label,
  defaultValue,
  required,
  placeholder = "Pick a date",
}: {
  name: string;
  label: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
}) {
  const initial = defaultValue && YMD.test(defaultValue.trim()) ? (defaultValue.trim() as ISODateString) : undefined;
  const [value, setValue] = useState<ISODateString | undefined>(initial);

  return (
    <>
      <input type="hidden" name={name} value={value ?? ""} />
      <DateInput
        label={label}
        isLabelHidden
        isRequired={required}
        value={value}
        onChange={setValue}
        placeholder={placeholder}
        format="date"
        hasClear={!required}
        width="100%"
      />
    </>
  );
}

/**
 * True when a template field should render as a calendar: an explicit
 * `date` type, or a legacy text field whose name/label/placeholder reads
 * like a date (so existing "Start date (YYYY-MM-DD)" fields upgrade for
 * free, with no data migration).
 */
export function isDateField(f: Pick<TemplateInputField, "type" | "name" | "label" | "placeholder">): boolean {
  if (f.type === "date") return true;
  if (f.type !== "text") return false;
  const hay = `${f.name} ${f.label ?? ""} ${f.placeholder ?? ""}`.toLowerCase();
  return /\bdate\b/.test(hay) || /y{2,4}[-/ ]?m{1,2}[-/ ]?d{1,2}/.test(hay);
}
