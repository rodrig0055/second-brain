/**
 * Small queries over the draft queue.
 *
 * In a plain module rather than inline in the page because these read the
 * clock, and the React Compiler's purity rule treats a component's whole body
 * as render — for good reason: a number derived from `Date.now()` inside a
 * component changes when React happens to re-run, not when the data changes.
 */

export type QueuedDraft = { status: string; requestedAt: Date };

/**
 * How many drafts were requested in the last `days`, ignoring archived ones.
 *
 * The doc asks for this: "a good way to easily see how many unique ads or
 * variants were requested or uploaded for the week".
 */
export function countRequestedWithin(
  drafts: QueuedDraft[],
  days = 7,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - days * 86_400_000;
  return drafts.filter(
    (d) => d.status !== "archived" && d.requestedAt.getTime() > cutoff,
  ).length;
}

/** How many reached Meta in the last `days`. */
export function countUploadedWithin(
  drafts: (QueuedDraft & { uploadedAt: Date | null })[],
  days = 7,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - days * 86_400_000;
  return drafts.filter(
    (d) => d.uploadedAt !== null && d.uploadedAt.getTime() > cutoff,
  ).length;
}
