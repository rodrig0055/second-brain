"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { MessagesSquare } from "lucide-react";
import {
  isDataUIPart,
  isTextUIPart,
  readUIMessageStream,
  type UIMessageChunk,
} from "ai";
import type { TemplateInputField } from "@/db/schema";
import { DatePicker, isDateField } from "@/components/date-picker";
import { TaskOutput } from "@/components/task-output";
import { ReportView } from "@/components/report-view";
import { ActivityLine, pickActivity } from "@/components/tool-activity";
import { startChatFromRun } from "@/app/(app)/chat/actions";
import { sseToStream } from "@/lib/sse-client";
import type { Report } from "@/lib/reports/schema";

type Brand = { id: string; name: string };

export function TaskRunner({
  teamSlug,
  templateId,
  fields,
  brands,
  models,
  templateModel,
  renderAs,
}: {
  teamSlug: string;
  templateId: string;
  fields: TemplateInputField[];
  brands: Brand[];
  models: { id: string; label: string }[];
  templateModel: string;
  renderAs: string;
}) {
  const [output, setOutput] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [activity, setActivity] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Default to the template's own model; the user can override per run.
  const [model, setModel] = useState(
    models.some((m) => m.id === templateModel) ? templateModel : models[0]?.id,
  );

  const inputCls =
    "u-transition rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none";

  function copyOutput() {
    navigator.clipboard.writeText(output || (report ? JSON.stringify(report, null, 2) : ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function run(formData: FormData) {
    const brandId = String(formData.get("brandId") ?? "");
    const inputs: Record<string, string> = {};
    for (const f of fields) inputs[f.name] = String(formData.get(f.name) ?? "");

    setStatus("running");
    setOutput("");
    setReport(null);
    setActivity(null);
    setError(null);
    setRunId(null);

    const isReport = renderAs === "report";

    try {
      const res = await fetch("/api/tasks/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, brandId, inputs, model }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }
      setRunId(res.headers.get("X-Run-Id"));

      // Both markdown and report runs stream as a UI-message stream: text +
      // tool-call parts (for the live activity line), plus a final data-report
      // part for report templates.
      const stream = readUIMessageStream({
        stream: sseToStream<UIMessageChunk>(res.body),
      });
      for await (const message of stream) {
        setActivity(pickActivity(message.parts));
        if (!isReport) {
          const text = message.parts
            .filter(isTextUIPart)
            .map((p) => p.text)
            .join("");
          if (text) setOutput(text);
        } else {
          const reportPart = message.parts.find(
            (p) => isDataUIPart(p) && p.type === "data-report",
          );
          if (reportPart) setReport((reportPart as { data: Report }).data);
        }
      }
      setActivity(null);
      setStatus("done");
    } catch (err) {
      setActivity(null);
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)] lg:gap-10">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (status === "running") return;
          run(new FormData(e.currentTarget));
        }}
        className="space-y-4 lg:sticky lg:top-8 lg:self-start"
      >
        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Brand
          <select name="brandId" required className={inputCls}>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-zinc-600">
          Model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={inputCls}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {fields.map((f) => (
          <label key={f.name} className="flex flex-col gap-1 text-xs text-zinc-600">
            {f.label || f.name}
            {f.required && <span className="sr-only">required</span>}
            {f.type === "textarea" ? (
              <textarea
                name={f.name}
                required={f.required}
                rows={4}
                placeholder={f.placeholder}
                className={inputCls}
              />
            ) : f.type === "select" ? (
              <SelectField field={f} className={inputCls} />
            ) : isDateField(f) ? (
              <DatePicker
                name={f.name}
                label={f.label || f.name}
                required={f.required}
                placeholder={f.placeholder || "Pick a date"}
              />
            ) : f.type === "number" ? (
              <input
                name={f.name}
                type="number"
                inputMode="decimal"
                required={f.required}
                placeholder={f.placeholder}
                className={inputCls}
              />
            ) : (
              <input
                name={f.name}
                required={f.required}
                placeholder={f.placeholder}
                className={inputCls}
              />
            )}
          </label>
        ))}

        <Button
          type="submit"
          label={status === "running" ? "Generating…" : "Generate"}
          variant="primary"
          width="100%"
          isDisabled={status === "running"}
        >
          {status === "running" ? <span className="u-shimmer">Generating…</span> : undefined}
        </Button>
      </form>

      <div
        className={`min-h-[26rem] min-w-0 ${
          report
            ? ""
            : "rounded-xl border border-zinc-200 bg-white p-4 shadow-card sm:p-6"
        }`}
      >
        {status === "idle" && (
          <div className="flex min-h-80 items-center justify-center text-center">
            <div>
              <p className="text-sm font-medium text-zinc-700">Ready when you are</p>
              <p className="mt-1 text-xs text-zinc-500">Complete the brief and generate your output.</p>
            </div>
          </div>
        )}
        {status === "running" && !output && !report && (
          activity ? (
            <ActivityLine label={activity} />
          ) : (
            <p className="u-shimmer text-sm font-medium">Generating…</p>
          )
        )}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {report && <ReportView data={report} />}
        {output && (
          <div className="animate-enter">
            <TaskOutput>{output}</TaskOutput>
          </div>
        )}
        {status === "done" && (
          <div className="mt-6 space-y-4 border-t border-zinc-200 pt-4">
            {runId && (
              <form action={startChatFromRun}>
                <input type="hidden" name="runId" value={runId} />
                <Button
                  type="submit"
                  label="Continue in chat"
                  variant="primary"
                  icon={<Icon icon={MessagesSquare} />}
                />
                <p className="mt-1.5 text-xs text-zinc-500">
                  Opens a chat preloaded with this task and its output — ask for
                  edits, expansions, or follow-ups.
                </p>
              </form>
            )}
            <div className="flex items-center gap-4 text-xs">
              <Button
                label={copied ? "Copied ✓" : "Copy"}
                variant="ghost"
                size="sm"
                onClick={copyOutput}
              />
              {runId && (
                <Link
                  href={`/t/${teamSlug}/runs/${runId}`}
                  className="text-zinc-600 underline underline-offset-2 hover:text-zinc-900"
                >
                  Saved to outputs →
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// A dropdown that, when its "Other" option is chosen, reveals a free-text input so the operator can
// type a value the dropdown doesn't list (the customer intake form is free text). Backward-compatible:
// selects without an "Other" option behave exactly like a plain <select>.
function SelectField({
  field,
  className,
}: {
  field: TemplateInputField;
  className: string;
}) {
  const options = field.options ?? [];
  const hasOther = options.some((o) => o.toLowerCase() === "other");
  const [value, setValue] = useState(options[0] ?? "");
  const [other, setOther] = useState("");
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
