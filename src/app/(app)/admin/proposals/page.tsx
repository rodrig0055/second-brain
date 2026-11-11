import { desc, eq } from "drizzle-orm";
import { AlertTriangle, EyeOff } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { db } from "@/db";
import { proposals } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import { ToneTag } from "@/components/status-badge";
import type { StatusTone } from "@/lib/status";
import {
  acceptProposal,
  dismissProposal,
  reopenProposal,
} from "./actions";

const KIND_LABELS: Record<string, string> = {
  "context-edit": "Knowledge doc",
  template: "New template",
  schedule: "New schedule",
  idea: "Idea",
  "open-loop": "Open question",
  preference: "Team preference",
};

const KIND_TONES: Record<string, StatusTone> = {
  "context-edit": "info",
  template: "progress",
  schedule: "scheduled",
  idea: "attention",
  "open-loop": "info",
  preference: "success",
};

type Evidence = {
  quotes?: { text: string; source: string; verified?: boolean }[];
  signals?: string[];
  blindSpots?: string[];
};

export default async function ProposalsPage() {
  await requireAdmin();

  const pending = await db.query.proposals.findMany({
    where: eq(proposals.state, "pending"),
    with: { brand: true, team: true },
    orderBy: [desc(proposals.createdAt)],
  });
  const decided = await db.query.proposals.findMany({
    with: { brand: true, team: true, decidedBy: true },
    orderBy: [desc(proposals.decidedAt)],
    limit: 25,
  });
  const recentlyDecided = decided.filter((p) => p.state !== "pending");

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-zinc-700">
          Proposals ({pending.length} waiting)
        </h2>
      </div>
      <p className="mt-2 max-w-3xl text-xs text-zinc-500">
        Every week the brain reads what actually happened for each brand, its
        chats, the tasks the team ran, sync failures, the calendar, and files what
        it thinks should change. Nothing here has been done. Accepting records the
        decision and stops it resurfacing; the work itself is yours.{" "}
        <strong>Say why when you dismiss something</strong> or the next pass
        cannot tell a bad idea from a mistimed one and will propose it again.
      </p>

      {pending.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-card">
          Nothing waiting. Proposals appear after the weekly pass, and only when
          the week gave it something real to go on.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {pending.map((p) => {
            const ev = (p.evidence ?? {}) as Evidence;
            const quotes = ev.quotes ?? [];
            const unverified = quotes.filter((q) => q.verified === false);
            return (
              <div
                key={p.id}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <ToneTag tone={KIND_TONES[p.kind] ?? "neutral"} label={KIND_LABELS[p.kind] ?? p.kind} />
                  <span className="text-sm font-medium text-zinc-900">
                    {p.title}
                  </span>
                  <span className="ml-auto text-xs text-zinc-500">
                    {p.brand.name}
                    {p.team ? ` · ${p.team.name}` : ""} ·{" "}
                    {new Date(p.createdAt).toLocaleDateString("en-PH")}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
                  {p.body}
                </p>

                {quotes.length > 0 && (
                  <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
                    <p className="font-medium text-zinc-600">
                      Why it thinks so
                      {unverified.length > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-normal text-amber-800">
                          <AlertTriangle className="size-3" />
                          {unverified.length} quote
                          {unverified.length === 1 ? "" : "s"} not found in the
                          source
                        </span>
                      )}
                    </p>
                    <ul className="mt-1 space-y-1.5">
                      {quotes.map((q, i) => (
                        <li key={i} className="text-zinc-700">
                          &ldquo;{q.text}&rdquo;
                          <span className="block text-zinc-400">
                            {q.source}
                            {q.verified === false && " · unverified"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(ev.blindSpots?.length ?? 0) > 0 && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-zinc-500">
                    <EyeOff className="mt-0.5 size-3 shrink-0" />
                    <span>Could not see: {ev.blindSpots!.join(" · ")}</span>
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={acceptProposal} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <input
                      type="text"
                      name="decision"
                      placeholder="Note (optional)"
                      className="w-44 rounded-md border border-zinc-200 px-2 py-1 text-xs"
                    />
                    <Button label="Accept" variant="primary" size="sm" type="submit" />
                  </form>
                  <form action={dismissProposal} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={p.id} />
                    <input
                      type="text"
                      name="decision"
                      required
                      placeholder="Why not? (required)"
                      className="w-52 rounded-md border border-zinc-200 px-2 py-1 text-xs"
                    />
                    <Button label="Dismiss" size="sm" type="submit" />
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {recentlyDecided.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-medium text-zinc-700">
            Recently decided
          </h2>
          <p className="mt-1 text-xs text-zinc-500">
            Kept with their reasoning. The next pass reads this so it does not
            re-propose what you have already turned down.
          </p>
          <div className="mt-4 space-y-2">
            {recentlyDecided.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-xs shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 font-medium ${
                      p.state === "applied"
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {p.state === "applied" ? "accepted" : "dismissed"}
                  </span>
                  <span className="font-medium text-zinc-800">{p.title}</span>
                  <span className="ml-auto text-zinc-400">
                    {p.brand.name} ·{" "}
                    {p.decidedBy?.name ?? p.decidedBy?.email ?? "unknown"}
                  </span>
                </div>
                {p.decision && (
                  <p className="mt-1 text-zinc-600">{p.decision}</p>
                )}
                <form action={reopenProposal} className="mt-1.5">
                  <input type="hidden" name="id" value={p.id} />
                  <Button label="Reopen" variant="ghost" size="sm" type="submit" />
                </form>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
