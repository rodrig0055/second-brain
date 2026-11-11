import { z } from "zod";

/**
 * Generative UI blocks: the small set of components an answer can be drawn
 * with instead of markdown.
 *
 * Two producers feed one renderer. Data tools are turned into blocks by code
 * (`toolView`), so their numbers never pass through the model. The model can
 * also ask for blocks itself through the `present` tool, using the schema
 * below. Both normalize to `Block`, which is what the chat renders.
 *
 * The model-facing schema is deliberately plain (string cells, no records, no
 * primitive unions) so the same tool definition works on Anthropic, OpenAI and
 * Gemini, whose JSON-schema support differs.
 */

// ---- model-facing schema (the `present` tool input) ----

const kpisSpec = z.object({
  type: z.literal("kpis"),
  items: z
    .array(
      z.object({
        label: z.string(),
        value: z.string().describe("Already formatted, e.g. '₱12,400' or '3.2%'."),
        note: z.string().optional().describe("Short context, e.g. '+12% vs last week'."),
      }),
    )
    .min(1)
    .max(8),
});

const tableSpec = z.object({
  type: z.literal("table"),
  title: z.string().optional(),
  columns: z.array(z.string()).min(1),
  rows: z.array(z.array(z.string())).describe("One array of cell strings per row, in column order."),
});

const chartSpec = z.object({
  type: z.literal("chart"),
  title: z.string().optional(),
  kind: z.enum(["line", "bar"]),
  labels: z.array(z.string()).describe("X-axis labels, e.g. dates or names."),
  series: z
    .array(z.object({ name: z.string(), values: z.array(z.number()) }))
    .min(1)
    .max(3),
});

const choicesSpec = z.object({
  type: z.literal("choices"),
  question: z.string().optional(),
  options: z
    .array(
      z.object({
        label: z.string().describe("The option itself, shown in full."),
        detail: z.string().optional().describe("One line on why or when to pick it."),
        reply: z
          .string()
          .optional()
          .describe("Message sent on the user's behalf when they pick it. Defaults to the label."),
      }),
    )
    .min(2)
    .max(8),
});

const draftSpec = z.object({
  type: z.literal("draft"),
  label: z.string().optional().describe("What this is, e.g. 'Instagram caption' or 'Email subject'."),
  text: z.string(),
  note: z.string().optional(),
});

const formSpec = z.object({
  type: z.literal("form"),
  title: z.string().optional(),
  fields: z
    .array(
      z.object({
        name: z.string(),
        label: z.string(),
        type: z.enum(["text", "textarea", "number", "date", "select"]),
        options: z.array(z.string()).optional().describe("Required for type 'select'."),
        placeholder: z.string().optional(),
        required: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(8),
  submitLabel: z.string().optional(),
});

const calloutSpec = z.object({
  type: z.literal("callout"),
  tone: z.enum(["info", "good", "warn"]),
  text: z.string(),
});

// z.union, not z.discriminatedUnion: the latter emits JSON-schema `oneOf`,
// which Gemini's schema subset rejects; `anyOf` works on every provider. The
// literal `type` on each member still makes the match unambiguous.
export const blockSpec = z.union([
  kpisSpec,
  tableSpec,
  chartSpec,
  choicesSpec,
  draftSpec,
  formSpec,
  calloutSpec,
]);

export const presentInput = z.object({
  title: z.string().optional(),
  blocks: z.array(blockSpec).min(1).max(8),
});

export type BlockSpec = z.infer<typeof blockSpec>;
export type PresentInput = z.infer<typeof presentInput>;

// ---- render model ----

export type Cell = string | number | null;

export type TableColumn = {
  key: string;
  label: string;
  numeric: boolean;
  /** "money" cells are formatted with the block's currency. */
  format?: "money" | "number" | "text";
  hidden?: boolean;
};

export type Kpi = {
  label: string;
  /** A number is formatted by the renderer; a string is shown as-is. */
  value: number | string;
  format?: "money" | "number";
  note?: string;
};

export type Block =
  | { type: "kpis"; items: Kpi[]; currency?: string }
  | {
      type: "table";
      title?: string;
      columns: TableColumn[];
      rows: Record<string, Cell>[];
      currency?: string;
    }
  | {
      type: "chart";
      title?: string;
      kind: "line" | "bar";
      labels: string[];
      series: { name: string; values: number[]; format?: "money" | "number" }[];
      currency?: string;
    }
  | Extract<BlockSpec, { type: "choices" | "draft" | "form" | "callout" }>;

/**
 * "₱12,400.50", "PHP 1,234", "-3.5", "12%" -> number; anything else (a path
 * like "/p5", a date, a name) -> null. Only a currency symbol or ISO code may
 * precede the digits.
 */
export function parseNumeric(s: string): number | null {
  const t = s.trim();
  if (!/^(?:[A-Z]{3} ?|S\$|[₱$€£฿₫])?-?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?%?$/.test(t)) return null;
  if (!/\d/.test(t)) return null;
  const n = Number(t.replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn a model-authored spec into a render block. Tables get numeric columns
 * detected (so they sort as numbers), and ragged rows are padded rather than
 * dropped. Charts are trimmed to the shortest of labels/values.
 */
export function normalizeSpec(spec: BlockSpec): Block {
  if (spec.type === "kpis") {
    return { type: "kpis", items: spec.items.map((k) => ({ ...k })) };
  }
  if (spec.type === "table") {
    const keys = spec.columns.map((_, i) => `c${i}`);
    const numeric = keys.map((_, i) => {
      const cells = spec.rows.map((r) => r[i]).filter((c) => c != null && c.trim() !== "");
      return cells.length > 0 && cells.every((c) => parseNumeric(c) !== null);
    });
    return {
      type: "table",
      title: spec.title,
      columns: spec.columns.map((label, i) => ({
        key: keys[i],
        label,
        numeric: numeric[i],
        format: "text",
      })),
      rows: spec.rows.map((r) =>
        Object.fromEntries(keys.map((k, i) => [k, r[i] ?? null] as const)),
      ),
    };
  }
  if (spec.type === "chart") {
    const n = Math.min(spec.labels.length, ...spec.series.map((s) => s.values.length));
    return {
      type: "chart",
      title: spec.title,
      kind: spec.kind,
      labels: spec.labels.slice(0, n),
      series: spec.series.map((s) => ({ name: s.name, values: s.values.slice(0, n) })),
    };
  }
  return spec;
}
