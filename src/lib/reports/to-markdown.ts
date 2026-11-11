import type { Report } from "./schema";

/**
 * Renders a structured report (KPI tiles + tables) into readable markdown, used
 * to seed a "continue in chat" conversation from a report task run so the chat
 * reads naturally instead of showing raw JSON.
 */
export function reportToMarkdown(report: Report): string {
  const lines: string[] = [`# ${report.title}`];
  if (report.period) lines.push(`_${report.period}_`);
  lines.push("", report.summary);

  if (report.kpis?.length) {
    lines.push("", "## Key metrics");
    for (const k of report.kpis) {
      const trend = k.trend ? ` (${k.trend})` : "";
      const sub = k.sublabel ? ` — ${k.sublabel}` : "";
      lines.push(`- **${k.label}:** ${k.value}${trend}${sub}`);
    }
  }

  for (const s of report.sections ?? []) {
    lines.push("", `## ${s.heading}`);
    if (s.table && s.table.columns.length) {
      lines.push("", `| ${s.table.columns.join(" | ")} |`);
      lines.push(`| ${s.table.columns.map(() => "---").join(" | ")} |`);
      for (const row of s.table.rows) lines.push(`| ${row.join(" | ")} |`);
    }
    for (const b of s.bullets ?? []) lines.push(`- ${b}`);
    if (s.note) lines.push("", `_${s.note}_`);
  }

  if (report.recommendations?.length) {
    lines.push("", "## Recommendations");
    report.recommendations.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
  }

  return lines.join("\n");
}
