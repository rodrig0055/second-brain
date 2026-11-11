import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { hypotheses, openLoops } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { StatusBadge, ToneTag } from "@/components/status-badge";

const PULL_LABEL: Record<string, string> = {
  curiosity: "cannot explain it",
  resonance: "notably good",
  surprise: "not what we expected",
  tension: "sources disagree",
  pattern: "keeps recurring",
  gap: "absent where expected",
};

const NO_MATCH = "00000000-0000-0000-0000-000000000000";

export default async function LoopsPage() {
  await requireAdmin();

  const loops = await db.query.openLoops.findMany({
    with: { brand: true, team: true },
    orderBy: [desc(openLoops.createdAt)],
    limit: 100,
  });
  const hyps = await db.query.hypotheses.findMany({
    with: { validations: true },
    where: inArray(
      hypotheses.loopId,
      loops.length ? loops.map((l) => l.id) : [NO_MATCH],
    ),
  });
  const hypByLoop = new Map(hyps.map((h) => [h.loopId, h]));

  const group = (s: string) => loops.filter((l) => l.state === s);
  const sections = [
    {
      title: "In flight",
      rows: group("promoted"),
      note: "Graded worth chasing.",
    },
    {
      title: "Answered",
      rows: group("answered"),
      note: "Verdicts carry a re-check date, because the account moves under a finding.",
    },
    {
      title: "Waiting to be graded",
      rows: group("captured"),
      note: "Captured, not yet scored. Grading compares the whole set at once, which is where the duplicates show up.",
    },
    {
      title: "Archived",
      rows: group("archived"),
      note: "Below the bar, a duplicate, or out of reach. Kept with the reasoning so it is not asked again.",
    },
  ];

  return (
    <div>
      <h2 className="text-sm font-medium text-zinc-700">
        Research loops ({group("captured").length} ungraded,{" "}
        {group("promoted").length} in flight, {group("answered").length} answered)
      </h2>
      <p className="mt-2 max-w-3xl text-xs text-zinc-500">
        Questions the brain cannot answer, and what happened when it tried. Each is
        graded on stakes, how solid the evidence is, whether our data can reach it,
        and whether it is genuinely new. The strong ones become a prediction with a
        test plan, then a verdict measured against a bar written before the research
        ran. An answer usually opens the next question.
      </p>

      {loops.length === 0 && (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-card">
          No loops yet. They arrive when you accept an open-question proposal in{" "}
          <span className="font-medium">Proposals</span>.
        </div>
      )}

      {sections.map(({ title, rows, note }) =>
        rows.length === 0 ? null : (
          <section key={title} className="mt-8">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              {title} ({rows.length})
            </h3>
            <p className="mt-1 text-xs text-zinc-400">{note}</p>
            <div className="mt-3 space-y-2">
              {rows.map((l) => {
                const h = hypByLoop.get(l.id);
                const v = h?.validations?.[0];
                return (
                  <div
                    key={l.id}
                    className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <ToneTag label={l.territory} />
                      {v && (
                        <StatusBadge status={v.verdict} />
                      )}
                      <span className="text-sm font-medium text-zinc-900">
                        {l.question}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-zinc-500">
                        {l.brand.name}
                        {l.team ? ` · ${l.team.name}` : ""}
                        {l.score ? ` · ${l.score.total}/20` : ""}
                        {l.tier ? ` · tier ${l.tier}` : ""}
                      </span>
                    </div>

                    <p className="mt-1.5 text-xs text-zinc-600">{l.observation}</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {PULL_LABEL[l.pull] ?? l.pull}: {l.pullNote} · Matters
                      because: {l.justification}
                    </p>

                    {l.score?.reasoning && (
                      <p className="mt-1.5 text-xs text-zinc-500">
                        Stakes {l.score.stakes}, evidence {l.score.confidence},
                        reachable {l.score.researchability}, new {l.score.novelty}.{" "}
                        {l.score.reasoning}
                      </p>
                    )}

                    {h && (
                      <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
                        <p className="font-medium text-zinc-600">
                          Prediction
                          {h.state === "unvalidatable" && " (cannot be tested)"}
                        </p>
                        <p className="mt-0.5 text-zinc-700">{h.prediction}</p>
                        {h.unvalidatableReason && (
                          <p className="mt-1 text-zinc-500">
                            {h.unvalidatableReason}
                          </p>
                        )}
                        {h.testPlan.length > 0 && (
                          <p className="mt-1 text-zinc-500">
                            Test: {h.testPlan.map((s) => s.tool).join(", ")}
                          </p>
                        )}
                      </div>
                    )}

                    {v && (
                      <div className="mt-2 rounded-md border border-zinc-200 px-3 py-2 text-xs">
                        <p className="whitespace-pre-wrap text-zinc-700">
                          {v.findings}
                        </p>
                        {(v.evidence.blindSpots?.length ?? 0) > 0 && (
                          <p className="mt-1 text-zinc-500">
                            Could not see: {v.evidence.blindSpots!.join(" · ")}
                          </p>
                        )}
                        {v.revalidateBy && (
                          <p className="mt-1 text-zinc-400">
                            Re-check by{" "}
                            {new Date(v.revalidateBy).toISOString().slice(0, 10)}
                          </p>
                        )}
                      </div>
                    )}

                    {l.archivedReason && (
                      <p className="mt-1.5 text-xs text-zinc-500">
                        Archived: {l.archivedReason}
                      </p>
                    )}
                    {l.parentLoopId && (
                      <p className="mt-1.5 text-[0.6875rem] text-zinc-400">
                        Opened by answering an earlier question.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
