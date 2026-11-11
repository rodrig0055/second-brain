import { generateObject } from "ai";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db } from "@/db";
import { knowledgeDocs, wikiActivity } from "@/db/schema";
import { resolveModel } from "@/lib/models";
import { dedupeSlug, slugify } from "@/lib/slug";
import { logUsage } from "@/lib/usage";
import {
  CONTRADICTION_OVERLAP,
  logWikiActivity,
  MAX_PENDING_LESSONS,
  MAX_VERBATIMS,
  MIN_USER_CHARS,
  MIN_USER_TURNS,
  WIKI_MODEL,
  type Verbatim,
} from "./shared";

/** Significant (4+ char) word tokens, lowercased, deduped. */
function tokenize(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
}

/** Share of the new lesson's tokens also present in an existing lesson (0–1). */
function overlapRatio(newTokens: Set<string>, existing: string): number {
  if (newTokens.size === 0) return 0;
  const other = tokenize(existing);
  let shared = 0;
  for (const t of newTokens) if (other.has(t)) shared++;
  return shared / newTokens.size;
}

/**
 * Post-chat reflection (Karpathy's query-writeback): after a substantive chat,
 * a cheap model decides whether the user taught something durable. If so it
 * files (or updates) a `lesson` knowledge doc, which buildSystemPrompt injects
 * into every future chat for that brand+team. Deliberately strict — storing
 * noise degrades the agent, so hasLesson=false is the normal outcome.
 */

const reflectionSchema = z.object({
  hasLesson: z
    .boolean()
    .describe(
      "true ONLY if this conversation produced a durable, reusable directive that would change how the assistant handles FUTURE, different conversations. Casual chat, one-off requests, and data lookups are false. Most conversations are false.",
    ),
  updateDocId: z
    .string()
    .nullable()
    .describe(
      "If the lesson refines/extends an EXISTING lesson listed in the prompt, its exact id. Else null.",
    ),
  supersedesDocId: z
    .string()
    .nullable()
    .describe(
      "If this NEW lesson makes an existing listed lesson obsolete (states a newer/contradicting fact about the same thing), that lesson's exact id — recorded as a hint for the human reviewer. Else null.",
    ),
  title: z
    .string()
    .max(80)
    .nullable()
    .describe(
      "Short imperative topic, e.g. 'Meta ROAS benchmark for prospecting'. Null if hasLesson=false.",
    ),
  content: z
    .string()
    .max(600)
    .nullable()
    .describe(
      "The lesson as 1-3 sentences of durable DIRECTIVE (what to always/never do, or a confirmed business fact), written for a future assistant with no memory of this conversation. Never a summary of what happened. Null if hasLesson=false.",
    ),
  rationale: z
    .string()
    .describe("One sentence: why this is/isn't a durable lesson."),
  verbatim: z
    .object({
      userQuote: z
        .string()
        .max(700)
        .describe(
          "The user's OWN WORDS that taught this, copied exactly from the transcript — not a paraphrase, not cleaned up. Copy the whole sentence, and more if the meaning needs it.",
        ),
      assistantQuote: z
        .string()
        .max(700)
        .nullable()
        .describe(
          "The assistant output the user was reacting to, copied exactly. A correction is meaningless without the thing it corrected. Null only if the lesson was volunteered rather than prompted by an output.",
        ),
    })
    .nullable()
    .describe(
      "The moment that produced this lesson, word for word. Null if hasLesson=false.",
    ),
});

/** Text of a message's text parts (tool parts stripped — re-derivable data). */
function textOf(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

/** Clamp keeping head + tail (corrections often land at message ends). */
function clampMiddle(s: string, max = 2000): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 400)} … ${s.slice(-400)}`;
}

function buildTranscript(messages: UIMessage[], answerText: string): string {
  const recent = messages.slice(-12);
  const lines = recent
    .map((m) => {
      const t = textOf(m).trim();
      return t ? `${m.role.toUpperCase()}: ${clampMiddle(t)}` : null;
    })
    .filter(Boolean) as string[];
  let transcript = lines.join("\n\n");
  if (transcript.length > 12000) transcript = transcript.slice(-12000);
  const answer = answerText.length > 4000 ? `${answerText.slice(0, 4000)}…` : answerText;
  return `Conversation transcript (may be truncated):\n\n${transcript}\n\nFinal assistant answer:\n${answer}\n\nDecide.`;
}

const normalizeQuote = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Build the verbatim record, checking the quote is real.
 *
 * The whole value of a verbatim is that it is what was actually said, so a
 * model-invented quote is worse than none: it would put words in the user's
 * mouth in a doc a human later reads as evidence. We check the quote against the
 * source text and mark it rather than dropping it, because a near-miss (the
 * model tidied an ellipsis) is still useful to a reviewer as long as it is
 * labelled. The review UI shows unverified quotes with a warning.
 *
 * Exported only so the guard itself can be exercised directly — it is pure, and
 * "does this catch an invented quote" is the one behaviour here worth checking
 * without burning a model call.
 */
export function buildVerbatim(
  raw: { userQuote: string; assistantQuote: string | null } | null,
  conversationId: string,
  userTexts: string[],
  answerText: string,
): Verbatim | null {
  if (!raw?.userQuote?.trim()) return null;
  const userHaystack = normalizeQuote(userTexts.join(" \n "));
  const assistantHaystack = normalizeQuote(answerText);
  const userOk = userHaystack.includes(normalizeQuote(raw.userQuote));
  const assistantOk =
    !raw.assistantQuote?.trim() ||
    assistantHaystack.includes(normalizeQuote(raw.assistantQuote));
  return {
    at: new Date().toISOString(),
    conversationId,
    userQuote: raw.userQuote.trim(),
    assistantQuote: raw.assistantQuote?.trim() || null,
    verified: userOk && assistantOk,
  };
}

/** Append a verbatim to a doc's existing metadata, newest last, bounded. */
function withVerbatim(
  existing: Record<string, unknown> | null | undefined,
  v: Verbatim | null,
): Record<string, unknown> {
  const meta = { ...(existing ?? {}) };
  if (!v) return meta;
  const prior = Array.isArray(meta.verbatims)
    ? (meta.verbatims as Verbatim[])
    : [];
  meta.verbatims = [...prior, v].slice(-MAX_VERBATIMS);
  return meta;
}

export async function runReflection(args: {
  conversationId: string;
  brandId: string;
  teamId: string;
  userId: string;
  messages: UIMessage[];
  answerText: string;
}): Promise<void> {
  try {
    // 1. Substantive-chat guard (no LLM, no DB).
    const userTexts = args.messages
      .filter((m) => m.role === "user")
      .map((m) => textOf(m).trim())
      .filter(Boolean);
    const userTurns = userTexts.length;
    const userChars = userTexts.reduce((n, t) => n + t.length, 0);
    if (userTurns < MIN_USER_TURNS && userChars < MIN_USER_CHARS) return;

    // 2. Throttle: skip unless there's new user input since the last look at
    //    this conversation. Every outcome below writes the throttle state.
    const last = await db.query.wikiActivity.findFirst({
      where: and(
        eq(wikiActivity.op, "reflection"),
        eq(wikiActivity.refId, args.conversationId),
      ),
      orderBy: [desc(wikiActivity.createdAt)],
    });
    const lastTurns = Number(last?.meta?.userTurns ?? 0);
    if (last && userTurns <= lastTurns) return;

    // 3. Candidates: active lessons in scope + human doc titles (don't restate).
    const lessonRows = await db.query.knowledgeDocs.findMany({
      where: and(
        eq(knowledgeDocs.brandId, args.brandId),
        eq(knowledgeDocs.kind, "lesson"),
        eq(knowledgeDocs.isActive, true),
        or(eq(knowledgeDocs.teamId, args.teamId), isNull(knowledgeDocs.teamId)),
      ),
      orderBy: [desc(knowledgeDocs.updatedAt)],
    });
    const candidateIds = new Set(lessonRows.map((d) => d.id));
    // Lessons awaiting review don't inject and don't evict anything — but the
    // review queue must stay drainable, so cap how many can pile up per scope.
    const pendingSameScope = lessonRows.filter(
      (d) => d.teamId === args.teamId && d.reviewState === "pending",
    ).length;
    const pendingFull = pendingSameScope >= MAX_PENDING_LESSONS;

    const humanTitles = await db.query.knowledgeDocs.findMany({
      where: and(
        eq(knowledgeDocs.brandId, args.brandId),
        eq(knowledgeDocs.isActive, true),
        inArray(knowledgeDocs.kind, [
          "brand-voice",
          "offer-rules",
          "catalog",
          "playbook",
          "winner",
        ]),
      ),
      columns: { title: true },
    });

    const filedFromThisConv = last?.docId
      ? lessonRows.find((d) => d.id === last.docId)
      : undefined;

    const candidateList =
      lessonRows.length > 0
        ? lessonRows
            .map((d) => `- ${d.id} · ${d.title} · ${d.content.slice(0, 200)}`)
            .join("\n")
        : "(none yet)";

    const system =
      `You maintain the long-term "lessons learned" memory of a marketing AI assistant. ` +
      `After each conversation you decide whether it taught something DURABLE. You are highly ` +
      `selective: most conversations teach nothing worth storing, and storing noise actively ` +
      `degrades the assistant. hasLesson=false is the normal, correct outcome.\n\n` +
      `A lesson qualifies ONLY if ALL are true:\n` +
      `1. FUTURE-CHANGING: it changes how the assistant should answer a future, DIFFERENT ` +
      `conversation (a correction of behavior, a confirmed business rule, a standing definition or preference).\n` +
      `2. USER-SOURCED: the user stated or confirmed it. Never store the assistant's own guesses ` +
      `or its analysis of one week's numbers.\n` +
      `3. NOT RE-DERIVABLE: not obtainable from live data tools (metrics and product feeds change ` +
      `weekly — storing them creates stale facts).\n` +
      `4. NOT ALREADY KNOWN: absent from the existing lessons and knowledge docs listed below.\n\n` +
      `NEVER store: conversation summaries; this week's metrics; one-off task instructions ` +
      `("write 5 captions for Friday"); pleasantries; anything already covered below.\n\n` +
      `Write lessons as directives for a future assistant with no memory of this conversation. ` +
      `Include concrete numbers/dates/names when the user gave them.\n\n` +
      `# Existing lessons (id · title · summary)\n${candidateList}\n\n` +
      (filedFromThisConv
        ? `You previously filed lesson ${filedFromThisConv.id} from this same conversation. ` +
          `Prefer updating it (updateDocId) over creating a near-duplicate; hasLesson=false if ` +
          `nothing new was taught since.\n\n`
        : "") +
      `# Knowledge docs already injected into every chat (titles — do not restate)\n` +
      (humanTitles.map((d) => `- ${d.title}`).join("\n") || "(none)") +
      `\n\nNew lessons are queued for human review before they take effect. If this ` +
      `lesson clearly makes one of the existing lessons above obsolete, set ` +
      `supersedesDocId to that lesson's id so the reviewer can retire it.\n\n` +
      `When hasLesson=true you MUST also return \`verbatim\`: the exact words from ` +
      `the transcript that taught this, plus the assistant output the user was ` +
      `reacting to. Copy them character for character — do not paraphrase, tidy, ` +
      `shorten or reconstruct them. The reviewer uses the quote to judge whether ` +
      `the user meant a standing rule or a one-off remark, which the distilled ` +
      `lesson alone cannot show. A quote that does not appear in the transcript is ` +
      `worse than no quote at all: it puts words in the user's mouth.`;

    // 4. The model call (classify.ts pattern).
    const model = await resolveModel(WIKI_MODEL);
    const { object, usage } = await generateObject({
      model,
      schema: reflectionSchema,
      system,
      prompt: buildTranscript(args.messages, args.answerText),
    });
    await logUsage({
      kind: "task",
      model: WIKI_MODEL,
      usage,
      userId: args.userId,
      brandId: args.brandId,
      teamId: args.teamId,
      refId: args.conversationId,
    });

    const meta = { userTurns };

    // 5. Validate + write. Gate fields are re-validated against the candidate
    //    set — a hallucinated id degrades to create/no-op, never a wrong write.
    const title = object.title?.trim() ?? "";
    const content = object.content?.trim() ?? "";
    if (!object.hasLesson || !title || !content) {
      await logWikiActivity({
        brandId: args.brandId,
        teamId: args.teamId,
        op: "reflection",
        action: "no-lesson",
        refId: args.conversationId,
        detail: object.rationale,
        meta,
        model: WIKI_MODEL,
      });
      return;
    }

    const verbatim = buildVerbatim(
      object.verbatim,
      args.conversationId,
      userTexts,
      args.answerText,
    );

    // Update-in-place: model-chosen id, or exact-title match in scope.
    const updateId =
      object.updateDocId && candidateIds.has(object.updateDocId)
        ? object.updateDocId
        : (lessonRows.find((d) => d.title === title)?.id ?? null);
    if (updateId) {
      const prior = lessonRows.find((d) => d.id === updateId);
      await db
        .update(knowledgeDocs)
        .set({
          title,
          content,
          // Each refinement keeps the moment that caused it, so the history of
          // why a lesson reads the way it does travels with the lesson.
          metadata: withVerbatim(prior?.metadata, verbatim),
          updatedAt: new Date(),
        }) // updatedById stays null = LLM-owned
        .where(eq(knowledgeDocs.id, updateId));
      await logWikiActivity({
        brandId: args.brandId,
        teamId: args.teamId,
        op: "reflection",
        action: "updated",
        docId: updateId,
        refId: args.conversationId,
        detail: object.rationale,
        meta,
        model: WIKI_MODEL,
      });
      return;
    }

    // New lesson: file it as PENDING (awaiting admin review in
    // /admin/wiki/pending) — it does not reach the prompt until approved.
    // Guard the queue so it stays drainable.
    if (pendingFull) {
      await logWikiActivity({
        brandId: args.brandId,
        teamId: args.teamId,
        op: "reflection",
        action: "skipped",
        refId: args.conversationId,
        detail: `pending review queue full (${MAX_PENDING_LESSONS}); not filing: ${object.rationale}`,
        meta,
        model: WIKI_MODEL,
      });
      return;
    }

    // Contradiction/duplication hint for the reviewer: existing APPROVED lessons
    // in scope whose wording heavily overlaps this one, plus the model's own
    // supersede hint. Flag, never overwrite — the admin reconciles.
    const newTokens = tokenize(`${title} ${content}`);
    const overlapWith = lessonRows
      .filter(
        (d) =>
          d.reviewState === "approved" &&
          overlapRatio(newTokens, `${d.title} ${d.content}`) >=
            CONTRADICTION_OVERLAP,
      )
      .map((d) => d.id);
    if (
      object.supersedesDocId &&
      candidateIds.has(object.supersedesDocId) &&
      !overlapWith.includes(object.supersedesDocId)
    ) {
      overlapWith.push(object.supersedesDocId);
    }

    // Stable slug for the index / cross-links, unique within this scope.
    const scopeSlugs = await db.query.knowledgeDocs.findMany({
      where: and(
        eq(knowledgeDocs.brandId, args.brandId),
        args.teamId
          ? eq(knowledgeDocs.teamId, args.teamId)
          : isNull(knowledgeDocs.teamId),
      ),
      columns: { slug: true },
    });
    const takenSlugs = new Set(
      scopeSlugs.map((d) => d.slug).filter((s): s is string => Boolean(s)),
    );
    const slug = dedupeSlug(slugify(title), takenSlugs);

    const [row] = await db
      .insert(knowledgeDocs)
      .values({
        brandId: args.brandId,
        teamId: args.teamId,
        kind: "lesson",
        title,
        slug,
        content,
        isActive: true,
        reviewState: "pending", // not injected until an admin approves
        // Provenance only. metadata never reaches the system prompt (see
        // buildSystemPrompt, which renders `content`), so the quote is available
        // to a human reviewer without costing a token in every chat.
        metadata: withVerbatim(
          overlapWith.length ? { overlapWith } : {},
          verbatim,
        ),
        updatedById: null, // LLM provenance — lint may auto-manage this doc
      })
      .returning({ id: knowledgeDocs.id });
    await logWikiActivity({
      brandId: args.brandId,
      teamId: args.teamId,
      op: "reflection",
      action: "created",
      docId: row.id,
      refId: args.conversationId,
      detail: `pending review — ${object.rationale}`,
      meta: overlapWith.length ? { ...meta, overlapWith } : meta,
      model: WIKI_MODEL,
    });
  } catch (err) {
    // Reflection must never break the chat that triggered it.
    console.error("reflection failed", err);
    await logWikiActivity({
      brandId: args.brandId,
      teamId: args.teamId,
      op: "reflection",
      action: "error",
      refId: args.conversationId,
      detail: String(err).slice(0, 500),
      status: "error",
      model: WIKI_MODEL,
    });
  }
}
