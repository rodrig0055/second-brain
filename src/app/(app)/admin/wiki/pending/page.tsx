import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeDocs, wikiActivity } from "@/db/schema";
import { requireAdmin } from "@/lib/access";
import type { Verbatim } from "@/lib/wiki/shared";
import { approveLesson, rejectLesson, supersedeLesson } from "./actions";
import { Button } from "@astryxdesign/core/Button";

export default async function PendingLessonsPage() {
  await requireAdmin();

  const pending = await db.query.knowledgeDocs.findMany({
    where: and(
      eq(knowledgeDocs.kind, "lesson"),
      eq(knowledgeDocs.reviewState, "pending"),
      eq(knowledgeDocs.isActive, true),
    ),
    with: { brand: true, team: true },
    orderBy: [desc(knowledgeDocs.updatedAt)],
  });

  // Resolve overlap-hint ids → titles (one query), and the reflection rationale
  // (the "created" activity row per lesson) for reviewer context.
  const overlapIds = [
    ...new Set(
      pending.flatMap(
        (d) => (d.metadata?.overlapWith as string[] | undefined) ?? [],
      ),
    ),
  ];
  const overlapDocs = overlapIds.length
    ? await db.query.knowledgeDocs.findMany({
        where: inArray(knowledgeDocs.id, overlapIds),
        columns: { id: true, title: true, content: true },
      })
    : [];
  const overlapById = new Map(overlapDocs.map((d) => [d.id, d]));

  const activity = pending.length
    ? await db.query.wikiActivity.findMany({
        where: inArray(
          wikiActivity.docId,
          pending.map((d) => d.id),
        ),
        orderBy: [desc(wikiActivity.createdAt)],
      })
    : [];
  const rationaleByDoc = new Map<string, string>();
  for (const a of activity) {
    if (a.docId && !rationaleByDoc.has(a.docId)) {
      rationaleByDoc.set(a.docId, a.detail);
    }
  }

  return (
    <div>
      <h2 className="text-sm font-medium text-zinc-700">
        Lesson review ({pending.length})
      </h2>
      <p className="mt-2 text-xs text-zinc-500">
        Lessons the assistant captured from chats. They do <strong>not</strong> affect any answer
        until you approve them here — this keeps unreviewed, possibly-wrong auto-notes out of the
        prompt. Approve to start injecting; reject to prune (the AI never re-adds a rejected lesson);
        if a lesson replaces an older one, use <em>Approve &amp; supersede</em>.
      </p>

      {pending.length === 0 ? (
        <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 shadow-card">
          Nothing awaiting review. New lessons appear here after substantive chats.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {pending.map((d) => {
            const overlaps = (
              (d.metadata?.overlapWith as string[] | undefined) ?? []
            )
              .map((id) => overlapById.get(id))
              .filter((x): x is NonNullable<typeof x> => Boolean(x));
            return (
              <div
                key={d.id}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                    pending
                  </span>
                  <span className="text-sm font-medium text-zinc-900">
                    {d.title}
                  </span>
                  <span className="ml-auto text-xs text-zinc-500">
                    {d.brand?.name ?? "unknown brand"}
                    {d.team ? ` · ${d.team.name}` : ""}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-zinc-700">{d.content}</p>
                {rationaleByDoc.get(d.id) && (
                  <p className="mt-1 text-xs italic text-zinc-400">
                    {rationaleByDoc.get(d.id)}
                  </p>
                )}

                {/* The moment that produced the lesson. The distilled directive
                    alone can't tell you whether the user meant a standing rule
                    or a passing remark about one campaign; their actual sentence
                    can, which is the whole reason it's kept. */}
                {(() => {
                  const vs = (d.metadata?.verbatims as Verbatim[] | undefined) ?? [];
                  const v = vs[vs.length - 1];
                  if (!v) return null;
                  return (
                    <div className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
                      <p className="font-medium text-zinc-600">
                        What was actually said
                        {!v.verified && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 font-normal text-amber-800">
                            not found in the transcript — treat as paraphrase
                          </span>
                        )}
                      </p>
                      {v.assistantQuote && (
                        <p className="mt-1 text-zinc-500">
                          <span className="font-medium">Assistant:</span> &ldquo;
                          {v.assistantQuote}&rdquo;
                        </p>
                      )}
                      <p className="mt-1 text-zinc-700">
                        <span className="font-medium">User:</span> &ldquo;
                        {v.userQuote}&rdquo;
                      </p>
                      {vs.length > 1 && (
                        <p className="mt-1 text-zinc-400">
                          +{vs.length - 1} earlier moment
                          {vs.length > 2 ? "s" : ""} kept on this lesson
                        </p>
                      )}
                    </div>
                  );
                })()}

                {overlaps.length > 0 && (
                  <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <p className="font-medium">
                      May overlap / contradict existing lesson
                      {overlaps.length > 1 ? "s" : ""}:
                    </p>
                    <ul className="mt-1 space-y-1">
                      {overlaps.map((o) => (
                        <li key={o.id}>
                          <span className="font-medium">{o.title}</span>
                          <span className="text-amber-700">
                            {" "}
                            — {o.content.slice(0, 140)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={approveLesson}>
                    <input type="hidden" name="id" value={d.id} />
                    <Button label="Approve" variant="primary" size="sm" type="submit" />
                  </form>
                  {overlaps.map((o) => (
                    <form action={supersedeLesson} key={o.id}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="oldId" value={o.id} />
                      <Button
                        label={`Approve & supersede “${o.title}”`}
                        size="sm"
                        type="submit"
                      />
                    </form>
                  ))}
                  <form action={rejectLesson}>
                    <input type="hidden" name="id" value={d.id} />
                    <Button label="Reject" size="sm" type="submit" />
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
