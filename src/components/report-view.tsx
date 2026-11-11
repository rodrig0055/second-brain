import type { Report } from "@/lib/reports/schema";

/**
 * Renders a structured report (from a "report" task template) as KPI tiles +
 * tables instead of prose. Pure presentational, safe in server or client
 * components. The layout favors scanning and gives wide tables room to breathe.
 */
export function ReportView({ data }: { data: Report }) {
  return (
    <div className="animate-enter space-y-5">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
          {data.title}
        </h2>
        {data.period && <p className="mt-0.5 text-xs text-zinc-500">{data.period}</p>}
        {data.summary && (
          <p className="mt-2 max-w-[75ch] text-sm leading-6 text-zinc-600">{data.summary}</p>
        )}
      </div>

      {data.kpis?.length > 0 && (
        <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 sm:grid-cols-3 lg:grid-cols-4">
          {data.kpis.map((k, i) => (
            <div
              key={i}
              className="min-w-0 border-b border-r border-zinc-200 px-4 py-3 last:border-r-0"
            >
              <p className="text-xs text-zinc-500">{k.label}</p>
              <p className="mt-1 flex items-center gap-1 text-lg font-semibold tabular-nums text-zinc-900">
                {k.value}
                <Trend trend={k.trend} />
              </p>
              {k.sublabel && (
                <p className="mt-0.5 truncate text-[0.65rem] text-zinc-400">{k.sublabel}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {data.sections?.map((s, i) => (
        <section key={i} className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-900">{s.heading}</h3>
          {s.table && s.table.columns.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-zinc-200">
              <table className="min-w-full border-collapse text-sm [&_tbody_tr:nth-child(even)]:bg-zinc-50">
                <thead>
                  <tr>
                    {s.table.columns.map((c, j) => (
                      <th
                        key={j}
                        className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 text-left font-semibold text-zinc-700"
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.table.rows.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          className="border-b border-zinc-100 px-3 py-2 align-top text-zinc-700 tabular-nums"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {s.bullets && s.bullets.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-zinc-700 marker:text-zinc-400">
              {s.bullets.map((b, j) => (
                <li key={j} className="leading-relaxed">
                  {b}
                </li>
              ))}
            </ul>
          )}
          {s.note && <p className="text-xs italic text-zinc-500">{s.note}</p>}
        </section>
      ))}

      {data.recommendations && data.recommendations.length > 0 && (
        <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <h3 className="text-sm font-semibold text-zinc-900">Recommendations</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700 marker:text-emerald-600">
            {data.recommendations.map((rec, i) => (
              <li key={i} className="leading-relaxed">
                {rec}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Trend({ trend }: { trend?: "up" | "down" | "flat" }) {
  if (!trend || trend === "flat") return null;
  const up = trend === "up";
  return (
    <span className={`text-xs ${up ? "text-emerald-700" : "text-amber-600"}`}>
      {up ? "↑" : "↓"}
    </span>
  );
}
