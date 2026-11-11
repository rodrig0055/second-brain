import { and, desc, eq, inArray } from "drizzle-orm";
import { AlertTriangle, FlaskConical, Lightbulb } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { db } from "@/db";
import { hypotheses, openLoops, proposals } from "@/db/schema";
import {
  acceptProposal,
  dismissProposal,
} from "@/app/(app)/admin/proposals/actions";

/**
 * "For you" — the half of the brain's proactive output that belongs to a person.
 *
 * Everything the weekly pass produces used to land in /admin, behind an admin
 * gate, which meant the person whose work actually caused a suggestion never saw
 * it. But a proposal that came out of your Meta Ads session is yours to judge,
 * and the research question you raised is yours to follow.
 *
 * The split is by ownership, resolved from whose conversation contains the
 * evidence (see src/lib/proposals/propose.ts). Anything with no owner is
 * organisational — a stale doc, a template run by three people — and stays in the
 * admin queue rather than being pushed at whoever chatted most recently. Nothing
 * is duplicated: an item is either yours or the org's.
 */

const KIND_LABEL: Record<string, string> = {
  "context-edit": "Knowledge doc",
  template: "New template",
  schedule: "New schedule",
  idea: "Idea",
  "open-loop": "Open question",
  preference: "Your preference",
};

const VERDICT_LABEL: Record<string, string> = {
  validated: "confirmed",
  invalidated: "ruled out",
  inconclusive: "inconclusive",
  insufficient: "not enough data",
};

const VERDICT_TONE: Record<string, string> = {
  validated: "bg-emerald-50 text-emerald-700",
  invalidated: "bg-red-50 text-red-600",
  inconclusive: "bg-amber-50 text-amber-800",
  insufficient: "bg-zinc-100 text-zinc-600",
};

export async function ForYou({ userId }: { userId: string }) {
  const [myProposals, myLoops] = await Promise.all([
    db.query.proposals.findMany({
      where: and(
        eq(proposals.sourceUserId, userId),
        eq(proposals.state, "pending"),
      ),
      with: { brand: true, team: true },
      orderBy: [desc(proposals.createdAt)],
      limit: 8,
    }),
    db.query.openLoops.findMany({
      where: and(
        eq(openLoops.sourceUserId, userId),
        inArray(openLoops.state, ["captured", "promoted", "answered"]),
      ),
      with: { brand: true },
      orderBy: [desc(openLoops.createdAt)],
      limit: 8,
    }),
  ]);

  // Verdicts for the answered ones, so a question you raised comes back with its
  // answer rather than just changing state silently.
  const answeredIds = myLoops.filter((l) => l.state === "answered").map((l) => l.id);
  const answered = answeredIds.length
    ? await db.query.hypotheses.findMany({
        where: inArray(hypotheses.loopId, answeredIds),
        with: { validations: true },
      })
    : [];
  const verdictByLoop = new Map(
    answered
      .filter((h) => h.validations.length > 0)
      .map((h) => [h.loopId, h.validations[0]]),
  );

  if (myProposals.length === 0 && myLoops.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium text-zinc-700">For you</h2>
      <p className="mt-1 text-xs text-zinc-500">
        Came out of your own work. Nothing here has been done, and none of it is
        shared with the team until you act on it.
      </p>

      <div className="mt-3 space-y-2">
        {myProposals.map((p) => {
          const quotes = p.evidence?.quotes ?? [];
          const q = quotes[0];
          return (
            <div
              key={p.id}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Lightbulb className="size-3.5 shrink-0 text-amber-500" />
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.6875rem] font-medium text-zinc-600">
                  {KIND_LABEL[p.kind] ?? p.kind}
                </span>
                <span className="text-sm font-medium text-zinc-900">
                  {p.title}
                </span>
                <span className="ml-auto shrink-0 text-xs text-zinc-500">
                  {p.brand.name}
                  {p.team ? ` · ${p.team.name}` : ""}
                </span>
              </div>

              <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-700">
                {p.body}
              </p>

              {q && (
                <p className="mt-2 border-l-2 border-zinc-200 pl-2.5 text-xs text-zinc-500">
                  &ldquo;{q.text}&rdquo;
                  <span className="mt-0.5 block text-zinc-400">
                    {q.source}
                    {q.verified === false && (
                      <span className="ml-1.5 inline-flex items-center gap-1 text-amber-700">
                        <AlertTriangle className="size-3" />
                        not found in the source
                      </span>
                    )}
                  </span>
                </p>
              )}

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <form action={acceptProposal}>
                  <input type="hidden" name="id" value={p.id} />
                  <Button
                    label={p.kind === "open-loop" ? "Research this" : "Accept"}
                    type="submit"
                    variant="primary"
                    size="sm"
                  />
                </form>
                <form action={dismissProposal} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <input
                    type="text"
                    name="decision"
                    required
                    placeholder="Why not? (required)"
                    className="w-48 rounded-md border border-zinc-200 px-2 py-1 text-xs"
                  />
                  <Button label="Not useful" type="submit" size="sm" />
                </form>
              </div>
            </div>
          );
        })}

        {myLoops.map((l) => {
          const v = verdictByLoop.get(l.id);
          return (
            <div
              key={l.id}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card"
            >
              <div className="flex flex-wrap items-center gap-2">
                <FlaskConical className="size-3.5 shrink-0 text-fuchsia-500" />
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[0.6875rem] font-medium text-zinc-600">
                  {l.state === "answered"
                    ? "Answered"
                    : l.state === "promoted"
                      ? "Being researched"
                      : "Queued for grading"}
                </span>
                {v && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[0.6875rem] font-medium ${VERDICT_TONE[v.verdict] ?? ""}`}
                  >
                    {VERDICT_LABEL[v.verdict] ?? v.verdict}
                  </span>
                )}
                <span className="text-sm font-medium text-zinc-900">
                  {l.question}
                </span>
                <span className="ml-auto shrink-0 text-xs text-zinc-500">
                  {l.brand.name} · {l.territory}
                </span>
              </div>
              {v ? (
                <p className="mt-1.5 text-xs text-zinc-600">{v.findings}</p>
              ) : (
                <p className="mt-1.5 text-xs text-zinc-500">{l.justification}</p>
              )}
              {l.parentLoopId && (
                <p className="mt-1 text-[0.6875rem] text-zinc-400">
                  Opened by answering an earlier question of yours.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
