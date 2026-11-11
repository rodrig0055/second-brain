import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { brands, teams, usageEvents, users } from "@/db/schema";
import { requireAdmin } from "@/lib/access";

const WINDOWS = [7, 30, 90] as const;

function fmtUsd(n: number) {
  return `$${n.toFixed(2)}`;
}
function fmtNum(n: number) {
  return n.toLocaleString("en-US");
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireAdmin();
  const { days: daysParam } = await searchParams;
  const days = WINDOWS.includes(Number(daysParam) as (typeof WINDOWS)[number])
    ? Number(daysParam)
    : 30;

  const cost = sql<number>`coalesce(sum(${usageEvents.costUsd}), 0)`;
  const tokens = sql<number>`coalesce(sum(${usageEvents.inputTokens} + ${usageEvents.outputTokens}), 0)`;
  const calls = sql<number>`count(*)`;
  const cacheRead = sql<number>`coalesce(sum(${usageEvents.cacheReadTokens}), 0)`;
  const inputTok = sql<number>`coalesce(sum(${usageEvents.inputTokens}), 0)`;
  const where = sql`${usageEvents.createdAt} >= now() - make_interval(days => ${days})`;

  const [totals] = await db
    .select({ cost, tokens, calls, cacheRead, inputTok })
    .from(usageEvents)
    .where(where);

  // Share of input tokens served from cache — the headline "is caching working"
  // number. High = repeat prompts are being reused instead of reprocessed.
  const cacheHitPct =
    Number(totals?.inputTok ?? 0) > 0
      ? (Number(totals?.cacheRead ?? 0) / Number(totals?.inputTok ?? 0)) * 100
      : 0;

  const byKind = await db
    .select({ key: sql<string>`${usageEvents.kind}::text`, cost, tokens, calls })
    .from(usageEvents)
    .where(where)
    .groupBy(usageEvents.kind)
    .orderBy(desc(cost));

  const byModel = await db
    .select({ key: usageEvents.model, cost, tokens, calls })
    .from(usageEvents)
    .where(where)
    .groupBy(usageEvents.model)
    .orderBy(desc(cost));

  const byTeam = await db
    .select({ key: teams.name, cost, tokens, calls })
    .from(usageEvents)
    .leftJoin(teams, sql`${usageEvents.teamId} = ${teams.id}`)
    .where(where)
    .groupBy(teams.name)
    .orderBy(desc(cost));

  const byBrand = await db
    .select({ key: brands.name, cost, tokens, calls })
    .from(usageEvents)
    .leftJoin(brands, sql`${usageEvents.brandId} = ${brands.id}`)
    .where(where)
    .groupBy(brands.name)
    .orderBy(desc(cost));

  const byUser = await db
    .select({ key: users.email, cost, tokens, calls })
    .from(usageEvents)
    .leftJoin(users, sql`${usageEvents.userId} = ${users.id}`)
    .where(where)
    .groupBy(users.email)
    .orderBy(desc(cost))
    .limit(15);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">Usage & cost</h2>
        <div className="flex gap-1 text-xs">
          {WINDOWS.map((w) => (
            <a
              key={w}
              href={`/admin/usage?days=${w}`}
              className={`rounded-md px-2.5 py-1 ${
                w === days
                  ? "bg-zinc-200 text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {w}d
            </a>
          ))}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Est. cost" value={fmtUsd(Number(totals?.cost ?? 0))} />
        <Card label="Tokens" value={fmtNum(Number(totals?.tokens ?? 0))} />
        <Card label="LLM calls" value={fmtNum(Number(totals?.calls ?? 0))} />
        <Card
          label="Prompt cache hit"
          value={`${cacheHitPct.toFixed(0)}%`}
        />
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        Image generations are counted from 2 Oct 2026. Before that date,
        chats and tasks that called tools logged only their final step, so
        older totals read low.
      </p>

      <Table title="By kind" rows={byKind} />
      <Table title="By model" rows={byModel} />
      <Table title="By team" rows={byTeam} nullLabel="No team" />
      <Table title="By brand" rows={byBrand} nullLabel="No brand" />
      {/* Calls with no user are background work: scheduled tasks and loops. */}
      <Table title="By user" rows={byUser} nullLabel="System" />
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

function Table({
  title,
  rows,
  nullLabel = "N/A",
}: {
  title: string;
  rows: { key: string | null; cost: number; tokens: number; calls: number }[];
  nullLabel?: string;
}) {
  const max = Math.max(...rows.map((r) => Number(r.cost)), 0.000001);
  return (
    <div className="mt-8">
      <p className="pb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        {title}
      </p>
      <div className="overflow-hidden rounded-lg border border-zinc-200">
        {rows.length === 0 && (
          <p className="px-4 py-3 text-sm text-zinc-500">No data.</p>
        )}
        {rows.map((r, i) => (
          <div
            key={i}
            className="relative flex flex-col gap-1 border-b border-zinc-200 px-4 py-2.5 text-sm last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div
              className="absolute inset-y-0 left-0 bg-zinc-100"
              style={{ width: `${(Number(r.cost) / max) * 100}%` }}
            />
            <span className="relative z-10 truncate text-zinc-900">
              {r.key ?? nullLabel}
            </span>
            <span className="relative z-10 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
              <span>{fmtNum(Number(r.tokens))} tok</span>
              <span>
                {fmtNum(Number(r.calls))} {Number(r.calls) === 1 ? "call" : "calls"}
              </span>
              <span className="w-16 text-right text-zinc-900">
                {fmtUsd(Number(r.cost))}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
