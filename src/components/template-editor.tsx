"use client";

import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Plus } from "lucide-react";
import type { TemplateInputField } from "@/db/schema";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";

type TeamOption = { id: string; name: string };
type ModelOption = { id: string; label: string };

export function TemplateEditor({
  action,
  deleteAction,
  teams,
  models,
  template,
}: {
  action: (formData: FormData) => void;
  deleteAction?: (formData: FormData) => void;
  teams: TeamOption[];
  models: ModelOption[];
  template?: {
    id: string;
    teamId: string;
    name: string;
    description: string;
    promptTemplate: string;
    model: string;
    inputFields: TemplateInputField[];
    isActive: boolean;
    reviewGate: boolean;
  };
}) {
  const [fields, setFields] = useState<TemplateInputField[]>(
    template?.inputFields ?? [],
  );

  function updateField(i: number, patch: Partial<TemplateInputField>) {
    setFields((f) => f.map((field, idx) => (idx === i ? { ...field, ...patch } : field)));
  }

  const inputCls =
    "rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none";

  return (
    <form action={action} className="space-y-6">
      {template && <input type="hidden" name="id" value={template.id} />}
      <input type="hidden" name="inputFieldsJson" value={JSON.stringify(fields)} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Name
          <input
            name="name"
            required
            defaultValue={template?.name}
            placeholder="Write newsletter"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Team
          <select
            name="teamId"
            defaultValue={template?.teamId ?? teams[0]?.id}
            className={inputCls}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Description (shown in the task gallery)
        <input
          name="description"
          defaultValue={template?.description}
          placeholder="Subject lines + full email body for one campaign."
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Model
        <select
          name="model"
          defaultValue={template?.model ?? models[0]?.id}
          className={inputCls}
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </label>

      <div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-zinc-600">
            Input fields. Use them in the prompt as {"{{field_name}}"}
          </p>
          <Button
            label="Add field"
            size="sm"
            icon={<Icon icon={Plus} />}
            onClick={() =>
              setFields((f) => [
                ...f,
                { name: `field_${f.length + 1}`, label: "", type: "text" },
              ])
            }
          />
        </div>
        <div className="mt-2 space-y-2">
          {fields.map((field, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-white p-2"
            >
              <input
                value={field.name}
                onChange={(e) => updateField(i, { name: e.target.value })}
                placeholder="variable_name"
                className={`${inputCls} w-36 font-mono text-xs`}
              />
              <input
                value={field.label}
                onChange={(e) => updateField(i, { label: e.target.value })}
                placeholder="Label shown to user"
                className={`${inputCls} w-48`}
              />
              <select
                value={field.type}
                onChange={(e) =>
                  updateField(i, {
                    type: e.target.value as TemplateInputField["type"],
                  })
                }
                className={inputCls}
              >
                <option value="text">Short text</option>
                <option value="textarea">Long text</option>
                <option value="select">Dropdown</option>
                <option value="date">Date</option>
                <option value="number">Number</option>
              </select>
              {field.type === "select" && (
                <input
                  value={(field.options ?? []).join(", ")}
                  onChange={(e) =>
                    updateField(i, {
                      options: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Option A, Option B"
                  className={`${inputCls} w-48`}
                />
              )}
              <label className="flex items-center gap-1 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={field.required ?? false}
                  onChange={(e) => updateField(i, { required: e.target.checked })}
                />
                required
              </label>
              <Button
                label="Remove"
                variant="ghost"
                size="sm"
                onClick={() => setFields((f) => f.filter((_, idx) => idx !== i))}
                className="ml-auto"
              />
            </div>
          ))}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs text-zinc-600">
        Prompt template
        <textarea
          name="promptTemplate"
          required
          rows={10}
          defaultValue={template?.promptTemplate}
          placeholder={"Draft an email newsletter.\nTheme: {{theme}}\nProducts: {{products}}"}
          className={`${inputCls} font-mono text-xs leading-relaxed`}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={template?.isActive ?? true}
        />
        Active (visible to the team)
      </label>

      <label className="flex items-start gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          name="reviewGate"
          defaultChecked={template?.reviewGate ?? false}
          className="mt-1"
        />
        <span>
          Review output before it ships
          <span className="mt-0.5 block text-xs text-zinc-500">
            Turn on for anything a customer will read: blog posts, product
            descriptions, meta fields, newsletters, ad copy. A second pass checks
            every figure against the brand docs and catches em dashes, over-length
            meta titles, banned terms and leftover placeholders, then attaches a
            receipt to the output. Costs one extra model call per run.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <Button type="submit" label="Save template" variant="primary" />
        {template && deleteAction && (
          <ConfirmSubmitButton
            formAction={deleteAction}
            message={`Delete “${template.name}”? This cannot be undone.`}
            label="Delete"
          />
        )}
      </div>
    </form>
  );
}
