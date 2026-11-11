"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Check, Copy, Info, Send, Sparkles } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Icon } from "@astryxdesign/core/Icon";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { KpiGrid, KpiTile } from "@/components/kpi-tile";
import { parseNumeric, type Block, type Cell } from "@/lib/genui/blocks";
import { CHART, axisProps, dayTick, gridProps } from "@/lib/insights/chart-theme";
import { formatCompactMoney, formatMoney, formatNumber } from "@/lib/insights/format";

/**
 * Renders generative UI blocks (lib/genui/blocks.ts) in the chat.
 *
 * `onReply` sends a message as the user: it is how a picked choice or a
 * submitted form continues the conversation. Interactive blocks are live only
 * on the latest answer; once the user has moved on they show what was picked.
 */

export type BlockContext = {
  /** Unique per block on the page: keys the table's saved column choice. */
  id: string;
  /** The card this block sits in ("Search Console queries Oct 1 - Oct 28"), naming its parts. */
  title?: string;
  interactive: boolean;
  /** The user's next message after this answer, if any. */
  answeredWith?: string;
  onReply?: (text: string) => void;
};

export function BlockView({ block, ctx }: { block: Block; ctx: BlockContext }) {
  switch (block.type) {
    case "kpis":
      return <KpisBlock block={block} />;
    case "table":
      return <TableBlock block={block} ctx={ctx} />;
    case "chart":
      return <ChartBlock block={block} />;
    case "choices":
      return <ChoicesBlock block={block} ctx={ctx} />;
    case "draft":
      return <DraftBlock block={block} />;
    case "form":
      return <FormBlock block={block} ctx={ctx} />;
    case "callout":
      return <CalloutBlock block={block} />;
  }
}

function fmt(v: number, format: "money" | "number" | undefined, currency?: string): string {
  if (format === "money" && currency) return formatMoney(v, currency);
  // Ratios like ROAS 4.95 must keep their decimals; counts stay whole.
  return Number.isInteger(v)
    ? formatNumber(v)
    : v.toLocaleString("en-PH", { maximumFractionDigits: 2 });
}

function KpisBlock({ block }: { block: Extract<Block, { type: "kpis" }> }) {
  const cols = block.items.length <= 2 ? 2 : block.items.length === 3 ? 3 : 4;
  return (
    <KpiGrid cols={cols}>
      {block.items.map((k, i) => (
        <KpiTile
          key={i}
          label={k.label}
          value={k.value}
          format={k.format === "money" && block.currency ? "money" : "number"}
          currency={block.currency}
          hint={k.note}
          // The model names these tiles; a glossary match could describe a different metric.
          definition={null}
        />
      ))}
    </KpiGrid>
  );
}

type Row = Record<string, Cell> & { __i: number };

function TableBlock({
  block,
  ctx,
}: {
  block: Extract<Block, { type: "table" }>;
  ctx: BlockContext;
}) {
  const rows: Row[] = block.rows.map((r, i) => ({ ...r, __i: i }));
  // The column that names the row can't be hidden; ids are hidden by default,
  // so it is the first visible one, not simply the first.
  const anchor = block.columns.find((c) => !c.hidden)?.key;
  const columns: DataTableColumn<Row>[] = block.columns.map((c) => ({
    key: c.key,
    label: c.label,
    value: (row) => {
      const v = row[c.key];
      if (v === null || v === undefined) return null;
      if (c.numeric && typeof v === "string") return parseNumeric(v) ?? v;
      return v;
    },
    // Strings are shown as written ("85%", "1,204"); only real numbers are
    // formatted. `v` may be the parsed sort value, so read the cell itself.
    format: (v, row) => {
      const raw = row[c.key];
      if (typeof raw === "string") return raw;
      return typeof v === "number"
        ? fmt(v, c.format === "money" ? "money" : "number", block.currency)
        : String(v);
    },
    align: c.numeric ? "right" : "left",
    numeric: c.numeric,
    defaultVisible: !c.hidden,
    lockVisible: c.key === anchor,
  }));
  return (
    <div>
      {block.title && <p className="mb-1.5 text-xs font-medium text-zinc-600">{block.title}</p>}
      <DataTable
        id={`genui.${ctx.id}`}
        label={block.title ?? ctx.title ?? "Table"}
        rows={rows}
        columns={columns}
        rowKey={(r) => String(r.__i)}
        search={rows.length > 10}
        csv={{ filename: block.title ?? "table" }}
        pageSize={10}
      />
    </div>
  );
}

function ChartBlock({ block }: { block: Extract<Block, { type: "chart" }> }) {
  const isDates = block.labels.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l));
  // One small chart per series: tool series mix sessions with revenue, and a
  // shared axis would flatten the smaller one into a line along the bottom.
  return (
    <div>
      {block.title && <p className="mb-1.5 text-xs font-medium text-zinc-600">{block.title}</p>}
      <div
        className={`grid gap-2 ${block.series.length > 1 ? "sm:grid-cols-2" : ""} ${
          block.series.length === 3 ? "lg:grid-cols-3" : ""
        }`}
      >
        {block.series.map((s, si) => {
          const data = block.labels.map((label, i) => ({ label, v: s.values[i] }));
          const tick = (v: number) =>
            s.format === "money" && block.currency
              ? formatCompactMoney(v, block.currency)
              : Intl.NumberFormat("en-PH", { notation: "compact" }).format(v);
          const color = s.format === "money" ? CHART.revenue : si === 0 ? "#18181b" : CHART.spend;
          const common = (
            <>
              <CartesianGrid {...gridProps} />
              <XAxis
                dataKey="label"
                {...axisProps}
                tickFormatter={isDates ? dayTick : undefined}
                minTickGap={16}
              />
              <YAxis {...axisProps} width={44} tickFormatter={tick} />
              <Tooltip
                formatter={(v) => [fmt(Number(v), s.format, block.currency), s.name]}
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
              />
            </>
          );
          return (
            <div key={si} className="rounded-lg border border-zinc-200 bg-white px-3 pb-2 pt-3 shadow-card">
              <p className="mb-1 text-xs text-zinc-500">{s.name}</p>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  {block.kind === "bar" ? (
                    <BarChart data={data}>
                      {common}
                      <Bar dataKey="v" fill={color} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  ) : (
                    <LineChart data={data}>
                      {common}
                      <Line dataKey="v" stroke={color} strokeWidth={2} dot={data.length <= 14} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChoicesBlock({
  block,
  ctx,
}: {
  block: Extract<Block, { type: "choices" }>;
  ctx: BlockContext;
}) {
  const picked = block.options.findIndex(
    (o) => ctx.answeredWith?.trim() === (o.reply ?? o.label).trim(),
  );
  return (
    <div>
      {block.question && <p className="mb-2 text-sm font-medium text-zinc-800">{block.question}</p>}
      <div className="grid gap-2">
        {block.options.map((o, i) => {
          const chosen = i === picked;
          return (
            <ClickableCard
              key={i}
              label={o.detail ? `${o.label}, ${o.detail}` : o.label}
              isDisabled={!ctx.interactive}
              onClick={() => ctx.onReply?.(o.reply ?? o.label)}
              padding={3}
              variant={chosen ? "muted" : "default"}
              width="100%"
              className={!ctx.interactive && !chosen ? "opacity-60" : undefined}
            >
              <span className="flex items-start gap-3 text-left">
              <span
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[0.7rem] font-medium tabular-nums ${
                  chosen ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {chosen ? <Check className="size-3" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block whitespace-pre-wrap text-sm text-zinc-900">{o.label}</span>
                {o.detail && <span className="mt-0.5 block text-xs text-zinc-500">{o.detail}</span>}
              </span>
              </span>
            </ClickableCard>
          );
        })}
      </div>
    </div>
  );
}

function DraftBlock({ block }: { block: Extract<Block, { type: "draft" }> }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(block.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked (permissions, insecure origin); the text is
      // still selectable.
    }
  }
  return (
    <div className="rounded-lg border border-zinc-200 bg-white shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3.5 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
          <Sparkles className="size-3.5" /> {block.label ?? "Draft"}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[0.7rem] tabular-nums text-zinc-400">
            {block.text.length.toLocaleString()} chars
          </span>
          <Button
            label={copied ? "Copied" : "Copy"}
            size="sm"
            onClick={copy}
            icon={<Icon icon={copied ? Check : Copy} />}
          />
        </span>
      </div>
      <p className="whitespace-pre-wrap px-3.5 py-3 text-sm leading-6 text-zinc-900">{block.text}</p>
      {block.note && <p className="border-t border-zinc-100 px-3.5 py-2 text-xs text-zinc-500">{block.note}</p>}
    </div>
  );
}

function FormBlock({
  block,
  ctx,
}: {
  block: Extract<Block, { type: "form" }>;
  ctx: BlockContext;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const done = !ctx.interactive;

  function submit() {
    const lines = block.fields
      .map((f) => [f.label, (values[f.name] ?? "").trim()] as const)
      .filter(([, v]) => v)
      .map(([label, v]) => `- ${label}: ${v}`);
    ctx.onReply?.(`${block.title ?? "Here are the details"}:\n${lines.join("\n")}`);
  }

  const input =
    "u-transition w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none disabled:bg-zinc-50 disabled:text-zinc-500";

  return (
    <form
      className="space-y-3 rounded-lg border border-zinc-200 bg-white p-3.5 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!done) submit();
      }}
    >
      {block.title && <p className="text-sm font-medium text-zinc-800">{block.title}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {block.fields.map((f) => {
          const common = {
            id: `${ctx.id}-${f.name}`,
            name: f.name,
            required: f.required,
            disabled: done,
            placeholder: f.placeholder,
            value: values[f.name] ?? "",
            onChange: (e: { target: { value: string } }) =>
              setValues((v) => ({ ...v, [f.name]: e.target.value })),
            className: input,
          };
          return (
            <label
              key={f.name}
              htmlFor={common.id}
              className={`block ${f.type === "textarea" ? "sm:col-span-2" : ""}`}
            >
              <span className="mb-1 block text-xs text-zinc-600">
                {f.label}
                {f.required && <span className="text-zinc-400"> *</span>}
              </span>
              {f.type === "textarea" ? (
                <textarea rows={3} {...common} />
              ) : f.type === "select" ? (
                <select {...common}>
                  <option value="">Choose…</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input type={f.type} {...common} />
              )}
            </label>
          );
        })}
      </div>
      {done ? (
        ctx.answeredWith && <p className="text-xs text-zinc-500">Sent.</p>
      ) : (
        <Button
          label={block.submitLabel ?? "Continue"}
          type="submit"
          variant="primary"
          endContent={<Icon icon={Send} size="sm" />}
        />
      )}
    </form>
  );
}

function CalloutBlock({ block }: { block: Extract<Block, { type: "callout" }> }) {
  const tone = {
    info: "border-zinc-200 bg-zinc-50 text-zinc-700",
    good: "border-emerald-200 bg-emerald-50 text-emerald-800",
    warn: "border-amber-200 bg-amber-50 text-amber-800",
  }[block.tone];
  const ToneIcon = block.tone === "warn" ? AlertTriangle : block.tone === "good" ? Check : Info;
  return (
    <p className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <ToneIcon className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0 break-words">{block.text}</span>
    </p>
  );
}
