import { Milestone } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";

import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Card, Chip, Th, inputClass, labelClass, pct, td } from "@/components/ai-search/bits";
import { loadActions, loadCycles, loadOwners, loadPrompts, loadScoredRuns, type ActionRow } from "@/lib/ai-search/data";
import { requireAiSearchTeam } from "@/lib/ai-search/gate";
import {
  ACTION_STATUSES,
  ACTION_STATUS_LABELS,
  DECISIONS,
  DECISION_LABELS,
  PHASE_LABELS,
  READINESS,
  READINESS_HINTS,
  TIERS,
  TIER_HINTS,
  TIER_LABELS,
  addDaysYmd,
  compareActions,
  cycleCalendar,
  cycleDay,
  defaultRetestOn,
  isTier,
  phaseOf,
  priority,
  suggestDecision,
  type Tier,
} from "@/lib/ai-search/model";
import { aiSearchToday } from "@/lib/ai-search/run";
import { inWindow, summarize, topicLift } from "@/lib/ai-search/score";
import { createAction, deleteAction, startCycle, updateAction } from "../actions";

function ScoreSelect({ name, defaultValue, label }: { name: string; defaultValue: number; label: string }) {
  return (
    <label className={labelClass}>
      {label}
      <select name={name} defaultValue={String(defaultValue)} className={inputClass}>
        <option value="1">1 low</option>
        <option value="2">2</option>
        <option value="3">3 high</option>
      </select>
    </label>
  );
}

/** The fields shared by the add and edit forms. */
function ActionFields({
  action,
  topics,
  owners,
  retestOn,
}: {
  action?: ActionRow;
  topics: string[];
  owners: { id: string; label: string }[];
  retestOn: string;
}) {
  return (
    <>
      <label className={labelClass}>
        Action
        <input name="title" required defaultValue={action?.title} className={inputClass} placeholder="Rewrite the same-day delivery page opener to answer the question" />
      </label>
      <label className={labelClass}>
        Hypothesis
        <textarea
          name="hypothesis"
          rows={3}
          defaultValue={action?.hypothesis}
          className={inputClass}
          placeholder="Assistants skip us for same-day prompts because our cutoff time is in an image, not the HTML"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Topic
          <input name="topic" list="ai-roadmap-topics" defaultValue={action?.topic} className={inputClass} />
          <datalist id="ai-roadmap-topics">
            {topics.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label className={labelClass}>
          Gap (readiness trait)
          <select name="readiness" required defaultValue={action?.readiness ?? "extractable"} className={inputClass}>
            {READINESS.map((r) => (
              <option key={r} value={r}>
                {r}: {READINESS_HINTS[r]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className={labelClass}>
        Evidence tier
        <select name="tier" required defaultValue={action?.tier ?? "do"} className={inputClass}>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {TIER_LABELS[t]}: {TIER_HINTS[t]}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <ScoreSelect name="impact" label="Impact" defaultValue={action?.impact ?? 2} />
        <ScoreSelect name="effort" label="Effort" defaultValue={action?.effort ?? 2} />
        <label className={labelClass}>
          Owner
          <select name="ownerId" defaultValue={action?.ownerId ?? ""} className={inputClass}>
            <option value="">Unassigned</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          KPI
          <input name="kpi" defaultValue={action?.kpi} className={inputClass} placeholder="Visibility on same-day prompts" />
        </label>
        <label className={labelClass}>
          Re-test on
          <input type="date" name="retestOn" defaultValue={action?.retestOn ?? retestOn} className={inputClass} />
        </label>
      </div>
    </>
  );
}

export default async function AiRoadmapPage({
  params,
  searchParams,
}: {
  params: Promise<{ team: string }>;
  searchParams: Promise<{ cycle?: string }>;
}) {
  const { team: teamSlug } = await params;
  const { team, brand } = await requireAiSearchTeam(teamSlug);
  const { cycle: rawCycle } = await searchParams;
  const today = aiSearchToday();

  const [cycles, prompts, owners] = await Promise.all([loadCycles(brand.id), loadPrompts(brand.id), loadOwners()]);
  const topics = [...new Set(prompts.map((p) => p.topic))].sort();
  const cycle = cycles.find((c) => String(c.number) === rawCycle) ?? cycles[0];

  const startForm = (
    <ActionSheet
      label={cycles.length ? "Start next cycle" : "Start cycle 1"}
      title="Start a 90-day cycle"
      description="15 days to plan, two 30-day build blocks, 15 days to re-test. A later cycle carries over the prompts and the open gaps."
      variant={cycles.length ? "secondary" : "primary"}
    >
      <form action={startCycle} className="grid gap-3">
        <input type="hidden" name="teamSlug" value={team.slug} />
        <label className={labelClass}>
          Day 1
          <input type="date" name="startOn" required defaultValue={today} className={inputClass} />
        </label>
        <label className={labelClass}>
          Notes
          <textarea name="notes" rows={3} className={inputClass} placeholder="Scope, e.g. Metro Manila same-day and occasions only" />
        </label>
        <Button type="submit" label="Start" variant="primary" size="sm" />
      </form>
    </ActionSheet>
  );

  if (!cycle) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <PageHeader title="AI roadmap" description="The fixes, sorted by evidence, in 90-day cycles." />
        <EmptyState
          icon={<Milestone className="size-4" />}
          title="No cycle yet"
          description="Start cycle 1 once the baseline has a few weeks of answers. Then write one hypothesis per gap and sort the fixes."
          action={startForm}
        />
      </div>
    );
  }

  const cal = cycleCalendar(cycle.startOn);
  const day = cycleDay(cycle.startOn, today);
  const phase = phaseOf(day);
  const actions = (await loadActions(cycle.id)).sort((a, b) =>
    compareActions({ ...a, tier: a.tier as Tier }, { ...b, tier: b.tier as Tier }),
  );

  // Lift: the action's topic from before the build (planning) to the re-test,
  // net of the topics no action touched (the control).
  const runs = await loadScoredRuns(brand.id, addDaysYmd(cycle.startOn, -28));
  const before = inWindow(runs, addDaysYmd(cycle.startOn, -28), cal.planning.to);
  const after = inWindow(runs, cal.retest.from, cal.retest.to);
  const touched = new Set(actions.map((a) => a.topic).filter(Boolean));
  const control = topics.filter((t) => !touched.has(t));
  const retesting = phase === "retest" || phase === "done";

  const addForm = (
    <ActionSheet label="Add action" title="Add an action" description="One action, one hypothesis, one owner, one KPI, one re-test date." width={672}>
      <form action={createAction} className="grid gap-3">
        <input type="hidden" name="teamSlug" value={team.slug} />
        <input type="hidden" name="cycleId" value={cycle.id} />
        <ActionFields topics={topics} owners={owners} retestOn={defaultRetestOn(cycle.startOn)} />
        <p className="text-xs text-zinc-500">
          The block is set from the scores: worth at least its effort goes in block 1, and a proven (Do) action with effort 3 always starts in block 1 because
          third-party coverage takes longest. Change it after.
        </p>
        <Button type="submit" label="Add" variant="primary" size="sm" />
      </form>
    </ActionSheet>
  );

  const groups: { key: string; title: string; rows: ActionRow[] }[] = [
    { key: "1", title: `Block 1 · ${cal.block1.from} to ${cal.block1.to}`, rows: actions.filter((a) => a.tier !== "parked" && a.block === 1) },
    { key: "2", title: `Block 2 · ${cal.block2.from} to ${cal.block2.to}`, rows: actions.filter((a) => a.tier !== "parked" && a.block === 2) },
    { key: "p", title: "Parked · monitoring only", rows: actions.filter((a) => a.tier === "parked") },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title={`AI roadmap · cycle ${cycle.number}`}
        description={`Day ${Math.max(1, Math.min(day, 90))} of 90 · ${PHASE_LABELS[phase]}. Planning ${cal.planning.from} to ${cal.planning.to}, re-test from ${cal.retest.from}.${cycle.notes ? ` ${cycle.notes}` : ""}`}
        action={
          <>
            {startForm}
            {addForm}
          </>
        }
      />

      {cycles.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {cycles.map((c) => (
            <Chip key={c.id} href={`?cycle=${c.number}`} label={`Cycle ${c.number}`} active={c.id === cycle.id} />
          ))}
        </div>
      )}

      <Card title="Evidence tiers" description="Sort every candidate fix before scoring it.">
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {TIERS.map((t) => (
            <li key={t}>
              <span className="font-medium text-zinc-900">{TIER_LABELS[t]}.</span> <span className="text-zinc-600">{TIER_HINTS[t]}</span>
            </li>
          ))}
          <li>
            <span className="font-medium text-zinc-900">Skip.</span>{" "}
            <span className="text-zinc-600">Buying, trading or faking mentions. Never an action.</span>
          </li>
        </ul>
      </Card>

      {groups.map((g) => (
        <section key={g.key}>
          <h2 className="mb-2 text-sm font-medium text-zinc-800">{g.title}</h2>
          {g.rows.length === 0 ? (
            <p className="text-sm text-zinc-400">Nothing here.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-card">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr>
                    <Th>Action</Th>
                    <Th>Tier</Th>
                    <Th right>I / E</Th>
                    <Th>Owner</Th>
                    <Th>KPI</Th>
                    <Th>Status</Th>
                    <Th>Re-test</Th>
                    <Th>Decision</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((a) => {
                    const lift = a.topic ? topicLift(before, after, a.topic, control) : null;
                    const suggestion = retesting ? suggestDecision(lift) : null;
                    const baseVis = a.topic ? summarize(before.filter((r) => r.topic === a.topic)).visibility : null;
                    return (
                      <tr key={a.id}>
                        <td className={`${td} max-w-sm`}>
                          <p className="font-medium text-zinc-900">{a.title}</p>
                          {a.hypothesis && <p className="mt-0.5 text-xs text-zinc-500">{a.hypothesis}</p>}
                          <p className="mt-0.5 text-xs text-zinc-400">
                            {a.readiness}
                            {a.topic ? ` · ${a.topic} (baseline ${pct(baseVis)})` : ""}
                          </p>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>{isTier(a.tier) ? TIER_LABELS[a.tier] : a.tier}</td>
                        <td className={`${td} whitespace-nowrap text-right tabular-nums`}>
                          {a.impact} / {a.effort}
                          <span className="block text-xs text-zinc-400">{priority(a.impact, a.effort).toFixed(1)}</span>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>{a.ownerName || <span className="text-red-600">none</span>}</td>
                        <td className={`${td} text-zinc-600`}>{a.kpi || "–"}</td>
                        <td className={`${td} whitespace-nowrap`}>{ACTION_STATUS_LABELS[a.status as keyof typeof ACTION_STATUS_LABELS] ?? a.status}</td>
                        <td className={`${td} whitespace-nowrap ${a.retestOn <= today && !a.decision ? "font-medium text-amber-700" : ""}`}>{a.retestOn}</td>
                        <td className={`${td} whitespace-nowrap`}>
                          {a.decision ? DECISION_LABELS[a.decision as keyof typeof DECISION_LABELS] : "–"}
                          {suggestion && !a.decision && (
                            <span className="block text-xs text-zinc-500" title="Modeled: topic visibility change against the control topics">
                              suggest {DECISION_LABELS[suggestion.decision]}: {suggestion.why}
                            </span>
                          )}
                        </td>
                        <td className={`${td} text-right`}>
                          <ActionSheet label="Edit" title="Edit action" variant="secondary" icon={<span />} width={672}>
                            <form action={updateAction} className="grid gap-3">
                              <input type="hidden" name="teamSlug" value={team.slug} />
                              <input type="hidden" name="actionId" value={a.id} />
                              <ActionFields action={a} topics={topics} owners={owners} retestOn={a.retestOn} />
                              <div className="grid gap-3 sm:grid-cols-3">
                                <label className={labelClass}>
                                  Block
                                  <select name="block" defaultValue={String(a.block)} className={inputClass}>
                                    <option value="1">Block 1</option>
                                    <option value="2">Block 2</option>
                                  </select>
                                </label>
                                <label className={labelClass}>
                                  Status
                                  <select name="status" defaultValue={a.status} className={inputClass}>
                                    {ACTION_STATUSES.map((s) => (
                                      <option key={s} value={s}>
                                        {ACTION_STATUS_LABELS[s]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className={labelClass}>
                                  Decision at re-test
                                  <select name="decision" defaultValue={a.decision ?? ""} className={inputClass}>
                                    <option value="">Not yet</option>
                                    {DECISIONS.map((d) => (
                                      <option key={d} value={d}>
                                        {DECISION_LABELS[d]}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>
                              <label className={labelClass}>
                                Notes
                                <textarea name="notes" rows={3} defaultValue={a.notes} className={inputClass} />
                              </label>
                              <Button type="submit" label="Save" variant="primary" size="sm" />
                            </form>
                            <form action={deleteAction} className="mt-4 border-t border-zinc-100 pt-4">
                              <input type="hidden" name="teamSlug" value={team.slug} />
                              <input type="hidden" name="actionId" value={a.id} />
                              <Button type="submit" label="Delete action" variant="destructive" size="sm" />
                            </form>
                          </ActionSheet>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
