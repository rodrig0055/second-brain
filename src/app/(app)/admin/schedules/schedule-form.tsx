"use client";

import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import type { TemplateInputField } from "@/db/schema";
import { DatePicker, isDateField } from "@/components/date-picker";
import { createSchedule } from "./actions";

type Template = { id: string; name: string; inputFields: TemplateInputField[] };
type Brand = { id: string; name: string };

const ctrl =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-400";

export function ScheduleForm({
  templates,
  brands,
}: {
  templates: Template[];
  brands: Brand[];
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const selected = templates.find((t) => t.id === templateId);
  const fields = selected?.inputFields ?? [];

  return (
    <form
      action={createSchedule}
      className="space-y-4"
    >

      <div className="grid grid-cols-2 gap-3">
        <Field label="What should run?">
          <select
            name="templateId"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            required
            className={ctrl}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="For which brand?">
          <select name="brandId" required className={ctrl}>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="How often?">
          <select name="frequency" className={ctrl}>
            <option value="daily">Every day</option>
            <option value="weekly">Every Monday</option>
          </select>
        </Field>
      </div>

      {fields.length > 0 ? (
        <div className="space-y-3 border-t border-zinc-200 pt-4">
          <p className="text-xs text-zinc-600">
            Fill in the details this task needs each time it runs:
          </p>
          {fields.map((f) => (
            <Field
              key={f.name}
              label={f.label + (f.required ? " *" : "")}
            >
              {f.type === "textarea" ? (
                <textarea
                  name={`input.${f.name}`}
                  rows={3}
                  required={f.required}
                  placeholder={f.placeholder}
                  className={ctrl}
                />
              ) : f.type === "select" ? (
                <select name={`input.${f.name}`} required={f.required} className={ctrl}>
                  {(f.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : isDateField(f) ? (
                <DatePicker
                  name={`input.${f.name}`}
                  label={f.label || f.name}
                  required={f.required}
                  placeholder={f.placeholder || "Pick a date"}
                />
              ) : f.type === "number" ? (
                <input
                  name={`input.${f.name}`}
                  type="number"
                  inputMode="decimal"
                  required={f.required}
                  placeholder={f.placeholder}
                  className={ctrl}
                />
              ) : (
                <input
                  name={`input.${f.name}`}
                  required={f.required}
                  placeholder={f.placeholder}
                  className={ctrl}
                />
              )}
            </Field>
          ))}
        </div>
      ) : (
        <p className="border-t border-zinc-200 pt-4 text-xs text-zinc-500">
          This task needs no extra details, it will just run on schedule.
        </p>
      )}

      <Button label="Create schedule" variant="primary" size="sm" type="submit" />
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-zinc-600">{label}</span>
      {children}
    </label>
  );
}
