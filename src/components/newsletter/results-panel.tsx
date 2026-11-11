import { BarChart3 } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { loadResults, sinceDaysAgo, summarise } from "@/lib/newsletter/results";
import { brandTone } from "@/lib/newsletter/brand-tone";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Bar width as a share of the biggest value, so rows compare at a glance. */
function Bar({ value, max }: { value: number; max: number }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <span className="block h-1.5 rounded-full bg-zinc-900/80" style={{ width: `${w}%` }} />
  );
}

export type ResultsBrand = { id: string; slug: string; name: string };

/**
 * Newsletter send results: what actually got clicked, per link.
 *
 * Lives under Dashboards rather than in the newsletter tab, because it answers
 * the same question as every other dashboard ("is this working?") rather than
 * the question the campaign tab answers ("what am I sending?"). It is also the
 * input to next week's proposals, via `summarise` in the planner.
 */
export async function NewsletterResults({
  brands, brandSlug, since,
}: {
  brands: ResultsBrand[];
  brandSlug?: string;
  since?: string;
}) {
  const brand = brands.find((b) => b.slug === (brandSlug ?? "bloomly-sg")) ?? brands[0];
  const from = since ?? sinceDaysAgo(90);

  const rows = brand ? await loadResults(brand.id, from) : [];
  const s = summarise(rows);
  const maxKind = s.byKind[0]?.clicks ?? 0;
  const maxTop = s.top[0]?.clicks ?? 0;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {brands.map((b) => {
          const on = b.id === brand?.id;
          return (
            <a key={b.id} href={`?nb=${b.slug}`}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
                on ? brandTone(b.slug).chip : "bg-white text-zinc-500 ring-zinc-200 hover:bg-zinc-50"
              }`}>
              {b.name}
            </a>
          );
        })}
        <span className="ml-auto text-xs text-zinc-500">since {from}</span>
      </div>
  {rows.length === 0 ? (
    <div className="mt-8">
      <EmptyState
        icon={<BarChart3 className="size-5" />}
        title="No results synced yet"
        description="Run the results ingest to pull this brand's send history from SendPulse."
      />
    </div>
  ) : (
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
      <div className="space-y-6">
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-zinc-900">
            {s.sends} sends · {s.clicks.toLocaleString()} clicks
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Where the clicks went, by what was clicked.
          </p>
          <ul className="mt-3 space-y-2.5">
            {s.byKind.map((k) => (
              <li key={k.kind}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="capitalize text-zinc-900">{k.kind}</span>
                  <span className="tabular-nums text-zinc-500">
                    {k.clicks.toLocaleString()} · {pct(k.share)}
                  </span>
                </div>
                <div className="mt-1"><Bar value={k.clicks} max={maxKind} /></div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="space-y-6">
        <section className="rounded-lg border border-zinc-200 bg-white">
          <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900">
            Top destinations
          </h2>
          <ul className="divide-y divide-zinc-100">
            {s.top.slice(0, 14).map((t) => (
              <li key={t.label} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-16 shrink-0 text-right text-sm font-medium tabular-nums text-zinc-900">
                  {t.clicks.toLocaleString()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-zinc-900">{t.label}</span>
                  <span className="mt-1 block"><Bar value={t.clicks} max={maxTop} /></span>
                </span>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums text-zinc-500">
                  {t.sends} sends
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white">
          <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold text-zinc-900">
            Recent sends
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-zinc-400">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 text-right font-medium">Delivered</th>
                  <th className="px-4 py-2 text-right font-medium">Open</th>
                  <th className="px-4 py-2 text-right font-medium">CTOR</th>
                  <th className="px-4 py-2 font-medium">Top click</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.slice(0, 25).map((r) => (
                  <tr key={r.sendpulseCampaignId}>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-zinc-600">{r.sendDate}</td>
                    <td className="max-w-[230px] truncate px-4 py-2 text-zinc-900">{r.subject}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-600">{r.delivered.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-600">{pct(r.openRate)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-600">{pct(r.ctor)}</td>
                    <td className="max-w-[180px] truncate px-4 py-2 text-zinc-500">
                      {r.links[0]?.label ?? "no clicks"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )}
    </div>
  );
}
