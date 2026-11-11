import { db } from "@/db";
import { wikiActivity, wikiOp } from "@/db/schema";
import { PASS_MODELS } from "@/lib/models";

/**
 * LLM wiki (Karpathy-style) — shared constants + the activity logger.
 *
 * The model maintains `lesson` / `wiki-page` / `wiki-index` docs inside
 * knowledge_docs; every decision it makes is recorded in wiki_activity
 * (Karpathy's log.md). Docs go live immediately (user decision) — the caps and
 * guards here are what keep unattended self-editing from degrading the brain.
 */

// Pinned like CLASSIFY_MODEL — cheap and sufficient for distill/summarize work.
export const WIKI_MODEL = PASS_MODELS.wiki;

/** Hard cap on APPROVED lessons per brand+team (reflection must replace or skip). */
export const MAX_ACTIVE_LESSONS = 20;
/** Hard cap on PENDING (awaiting-review) lessons per brand+team — bounds the
 *  review queue so an un-drained queue can't grow without limit. */
export const MAX_PENDING_LESSONS = 15;
/** Token-overlap ratio (shared / new) above which a pending lesson is flagged as
 *  possibly contradicting/duplicating an existing approved one, for admin review. */
export const CONTRADICTION_OVERLAP = 0.5;
/** How many lessons buildSystemPrompt injects per chat. */
export const MAX_LESSONS_IN_PROMPT = 8;
/** Max lint deactivations per brand per run. */
export const MAX_LINT_DEACTIVATIONS = 3;
/** Reflection substantive-chat guard. */
export const MIN_USER_TURNS = 2;
export const MIN_USER_CHARS = 400;

/**
 * The moment a lesson came from, kept word for word in the doc's `metadata`
 * (never in `content`, so it is provenance for the reviewer and never reaches
 * the system prompt).
 *
 * An abstracted rule drifts; the sentence that caused it does not. A reviewer
 * reading "always use net-new CPA, not blended" cannot tell whether the user
 * meant a standing rule or said it once about one campaign. The quote can.
 */
export type Verbatim = {
  at: string;
  conversationId: string;
  userQuote: string;
  assistantQuote: string | null;
  /** False when the quote was not found in the transcript it claims to come from. */
  verified: boolean;
};

/** Keep the most recent few; a lesson refined for years should not grow forever. */
export const MAX_VERBATIMS = 3;

export type WikiActivityRow = {
  brandId: string;
  // Derived from the pg enum rather than restated, so adding an op to the schema
  // cannot silently leave this union behind.
  op: (typeof wikiOp.enumValues)[number];
  action: string;
  teamId?: string | null;
  docId?: string | null;
  refId?: string | null;
  detail?: string;
  meta?: Record<string, unknown>;
  model?: string | null;
  status?: "running" | "done" | "error";
};

/**
 * Append one wiki_activity row. Never throws (mirrors logUsage) — an audit
 * failure must not break the chat/cron flow that triggered it.
 */
export async function logWikiActivity(row: WikiActivityRow): Promise<void> {
  try {
    await db.insert(wikiActivity).values({
      brandId: row.brandId,
      teamId: row.teamId ?? null,
      op: row.op,
      action: row.action,
      docId: row.docId ?? null,
      refId: row.refId ?? null,
      detail: row.detail ?? "",
      meta: row.meta ?? {},
      model: row.model ?? null,
      status: row.status ?? "done",
    });
  } catch (err) {
    console.error("logWikiActivity failed", err);
  }
}
