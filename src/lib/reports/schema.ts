import { z } from "zod";

/**
 * Generic structured-report shape emitted by "report" task templates and
 * rendered as KPI tiles + tables by <ReportView>. Deliberately channel-agnostic
 * so the same shape works for SendPulse, Meta, GSC, etc. Keep fields flat and
 * string-typed (values pre-formatted by the model / tools) — the renderer does
 * no math.
 */
export const reportSchema = z.object({
  title: z.string().describe("Report title, e.g. 'Weekly Email Report — Bloomly PH'."),
  period: z
    .string()
    .optional()
    .describe("Human-readable date range covered, e.g. 'Jun 29 – Jul 5, 2026'."),
  summary: z.string().describe("2–3 sentence plain-language overview of the results."),
  kpis: z
    .array(
      z.object({
        label: z.string().describe("Metric name, e.g. 'Open rate'."),
        value: z.string().describe("Pre-formatted value, e.g. '13.1%' or '25,112'."),
        sublabel: z
          .string()
          .optional()
          .describe("Optional context under the value, e.g. 'of 16,614 delivered'."),
        trend: z
          .enum(["up", "down", "flat"])
          .optional()
          .describe("Direction vs a prior period, if known."),
      }),
    )
    .describe("Headline metric tiles (aim for 3–6)."),
  sections: z
    .array(
      z.object({
        heading: z.string(),
        table: z
          .object({
            columns: z.array(z.string()),
            rows: z.array(z.array(z.string())),
          })
          .optional()
          .describe("Tabular data; each row's length must match columns."),
        bullets: z.array(z.string()).optional(),
        note: z.string().optional(),
      }),
    )
    .describe("Detail sections — a table and/or bullets per section."),
  recommendations: z
    .array(z.string())
    .optional()
    .describe("Prioritized action items."),
});

export type Report = z.infer<typeof reportSchema>;
