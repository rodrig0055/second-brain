import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { conversations, taskTemplates } from "@/db/schema";
import { MODEL_OPTIONS, RETIRED_MODEL_SUCCESSORS } from "@/lib/models";

/**
 * Repoint stored config rows whose model id has been retired at its successor.
 *
 * Needed because /admin/templates renders the model as a <select> over
 * MODEL_OPTIONS: a stored id that is not an option silently flips to the first
 * option the next time an admin saves the template. Only config columns are
 * touched (task_templates.model, conversations.model); history (task_runs,
 * usage_events, wiki_activity, validations) records what actually ran and is
 * left alone.
 *
 * Idempotent, so the daily cron can run it unconditionally: once the rows are
 * moved the updates match nothing.
 */

/**
 * Follow successor chains to a live id (a -> b where b was later retired -> c),
 * dropping any entry that does not end in MODEL_OPTIONS. A map entry for an id
 * that is still selectable is ignored, so a mistaken entry can never move rows
 * off a live model.
 */
export function resolvedSuccessors(): Record<string, string> {
  const live = new Set<string>(MODEL_OPTIONS.map((o) => o.id));
  const out: Record<string, string> = {};
  for (const from of Object.keys(RETIRED_MODEL_SUCCESSORS)) {
    if (live.has(from)) continue;
    let to: string | undefined = RETIRED_MODEL_SUCCESSORS[from];
    for (let hops = 0; to && !live.has(to) && hops < 10; hops++) {
      to = RETIRED_MODEL_SUCCESSORS[to];
    }
    if (to && live.has(to)) out[from] = to;
  }
  return out;
}

export type RemapResult = {
  templates: number;
  conversations: number;
  error?: string;
};

export async function remapRetiredModels(): Promise<RemapResult> {
  const map = resolvedSuccessors();
  const retired = Object.keys(map);
  if (retired.length === 0) return { templates: 0, conversations: 0 };

  const caseExpr = (col: typeof taskTemplates.model | typeof conversations.model) =>
    sql`case ${col} ${sql.join(
      retired.map((from) => sql`when ${from} then ${map[from]}`),
      sql` `,
    )} else ${col} end`;

  try {
    const t = await db
      .update(taskTemplates)
      .set({ model: caseExpr(taskTemplates.model) })
      .where(inArray(taskTemplates.model, retired))
      .returning({ id: taskTemplates.id });
    const c = await db
      .update(conversations)
      .set({ model: caseExpr(conversations.model) })
      .where(inArray(conversations.model, retired))
      .returning({ id: conversations.id });
    return { templates: t.length, conversations: c.length };
  } catch (err) {
    console.error("model remap failed", err);
    return { templates: 0, conversations: 0, error: String(err).slice(0, 300) };
  }
}
