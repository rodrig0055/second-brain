import { generateObject } from "ai";
import { z } from "zod";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  brands,
  conversations,
  proposals,
  taskRuns,
  teams,
  wikiActivity,
} from "@/db/schema";
import { resolveModel, PASS_MODELS } from "@/lib/models";
import { logUsage } from "@/lib/usage";
import { logWikiActivity } from "@/lib/wiki/shared";
import { gatherBrandSignals, type BrandSignals } from "./signals";

/**
 * The proactive pass.
 *
 * Once a week the brain reads what actually happened for a brand and files what
 * it thinks should change. It never applies anything: every output lands in the
 * inbox as `pending` for a person to accept or dismiss, and a dismissal keeps its
 * reason so the same suggestion does not come back next week.
 *
 * The value is not the suggestion, it is the suggestion *with the evidence under
 * it*. So the hard rule is verbatim: a proposal carries the sentence someone
 * actually typed, not a paraphrase of it. A flattened "the team wanted better
 * reporting" is unactionable; "can you stop giving me blended CPA, I only care
 * about net-new" is a proposal you can build from.
 */

// Same tier as the review gate: this writes into a queue a human reads, so
// judgment about what is worth their attention matters more than speed.
export const PROPOSE_MODEL = PASS_MODELS.propose;

/** Per brand, per run. A wall of proposals is the same as none. */
export const MAX_PROPOSALS_PER_RUN = 4;

/** Stop filing once this many are already waiting, so the inbox stays drainable. */
export const MAX_PENDING_PER_BRAND = 12;

const proposalSchema = z.object({
  proposals: z
    .array(
      z.object({
        kind: z.enum([
          "context-edit",
          "template",
          "schedule",
          "idea",
          "open-loop",
          "preference",
        ]),
        title: z
          .string()
          .max(90)
          .describe("A specific, plain title. Not a category label."),
        body: z
          .string()
          .max(900)
          .describe(
            "What you are proposing and why, written for a busy marketer to act on. Say what should change and what it would take. No preamble.",
          ),
        teamSlug: z
          .string()
          .nullable()
          .describe(
            "The team slug this belongs to if it clearly belongs to one, else null.",
          ),
        quotes: z
          .array(
            z.object({
              text: z
                .string()
                .max(500)
                .describe(
                  "An EXACT sentence copied from the signals above, character for character. Never paraphrased, never tidied.",
                ),
              source: z
                .string()
                .max(120)
                .describe("Where it came from, e.g. 'chat: Weekly SEO review'."),
            }),
          )
          .describe(
            "The evidence. At least one exact quote, or the proposal has nothing under it.",
          ),
      }),
    )
    .max(MAX_PROPOSALS_PER_RUN)
    .describe(
      "Only proposals with real evidence from THIS week. An empty list is the correct and common answer.",
    ),
  nothingToPropose: z
    .string()
    .describe(
      "If the list is empty, one line on why. If it is not empty, an empty string.",
    ),
});

const SYSTEM = `You read one brand's week inside a marketing team's shared brain, and you propose what should change. You are writing into a queue a busy marketer will read, so a wall of vague suggestions is worse than nothing.

You never apply anything. Everything you file is a proposal a human accepts or dismisses.

**Propose only from evidence in the signals given to you.** Not from general marketing knowledge, not from what a brand like this usually needs. If the week did not show it, it is not a proposal. An empty list is the correct and most common answer, and filing nothing is always better than filing filler.

**Every proposal carries at least one exact quote.** Copy the sentence from the signals character for character. Do not paraphrase it, do not tidy it, do not merge two sentences. The quote is what lets a human judge in five seconds whether you are right, and a proposal whose quote turns out to be invented is worse than no proposal.

**Never repeat what already exists or was already declined.** The signals list the knowledge docs, templates, and prior proposals. A dismissed proposal stays dismissed unless the week produced genuinely new evidence, in which case say what changed.

The six kinds, and what each is actually for:
- **context-edit**: a knowledge doc is wrong, out of date, or missing something this week revealed. Name the doc.
- **template**: the team did the same shaped piece of work by hand and it should be a reusable task.
- **schedule**: they asked for the same thing repeatedly. The signal is repetition, not usefulness.
- **idea**: a campaign, content, or offer idea the week surfaced. Tie it to the calendar when relevant.
- **open-loop**: a question you cannot answer that would change what the brand does if answered. A real question, not a disguised recommendation, and not a task. Ask What, How much, Why, Who, or Where, and do not build the answer into the question. **Infrastructure is never an open loop.** A broken sync, a missing connection, an unavailable tool, a gap in the data is a blind spot to report, not a question to research: "verify the Meta connection" is a chore, and filing it here buries the real questions under maintenance tickets.
- **preference**: a standing way this team wants things done, revealed by a correction.

**Do not lower the bar to fill a quota.** There is no minimum. If the strong signals in this window are already covered by the proposals listed as filed, the honest answer is an empty list, and a vague suggestion like "scale the top performers" costs a person's attention while telling them nothing they did not know. Ask yourself of each one: could someone read this and know exactly what to do differently? If not, drop it.

Say the smallest true thing. Plain words, no em dashes, no marketing voice.`;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export type ProposeResult = {
  brand: string;
  ok: boolean;
  filed: number;
  skipped: string | null;
  error?: string;
};

/**
 * Run the pass for one brand. Never throws; a failure is logged and reported so
 * one brand cannot take down the weekly sweep.
 */
export async function proposeForBrand(
  brand: { id: string; slug: string; name: string },
  runRef: string,
): Promise<ProposeResult> {
  try {
    // Do not add to a queue nobody is draining.
    const pendingCount = await db.$count(
      proposals,
      and(eq(proposals.brandId, brand.id), eq(proposals.state, "pending")),
    );
    if (pendingCount >= MAX_PENDING_PER_BRAND) {
      const skipped = `${pendingCount} proposals already pending; not filing more until the inbox is drained`;
      await logWikiActivity({
        brandId: brand.id,
        op: "propose",
        action: "skipped",
        detail: skipped,
        meta: { runRef },
      });
      return { brand: brand.slug, ok: true, filed: 0, skipped };
    }

    // Throttle on new activity, the same way reflection does.
    //
    // Without this, running the pass twice over the same week produces more
    // proposals the second time and they are worse: the strong signals are
    // already filed, so the model reaches for whatever is left and files
    // "scale the top performers". A pass with nothing new to read should file
    // nothing, not lower its bar.
    const lastPass = await db.query.wikiActivity.findFirst({
      where: and(
        eq(wikiActivity.brandId, brand.id),
        eq(wikiActivity.op, "propose"),
      ),
      orderBy: [desc(wikiActivity.createdAt)],
    });
    if (lastPass) {
      const newerChat = await db.$count(
        conversations,
        and(
          eq(conversations.brandId, brand.id),
          gt(conversations.updatedAt, lastPass.createdAt),
        ),
      );
      const newerRun = await db.$count(
        taskRuns,
        and(
          eq(taskRuns.brandId, brand.id),
          gt(taskRuns.createdAt, lastPass.createdAt),
        ),
      );
      if (newerChat === 0 && newerRun === 0) {
        const skipped = `nothing new since the last pass on ${lastPass.createdAt.toISOString().slice(0, 10)}`;
        await logWikiActivity({
          brandId: brand.id,
          op: "propose",
          action: "throttled",
          detail: skipped,
          meta: { runRef },
        });
        return { brand: brand.slug, ok: true, filed: 0, skipped };
      }
    }

    const signals: BrandSignals = await gatherBrandSignals(brand);
    if (signals.empty) {
      const skipped =
        "no conversations or task runs this week, so there is no team signal to propose from";
      await logWikiActivity({
        brandId: brand.id,
        op: "propose",
        action: "skipped",
        detail: skipped,
        meta: { runRef, blindSpots: signals.blindSpots },
      });
      return { brand: brand.slug, ok: true, filed: 0, skipped };
    }

    const blindSpotBlock =
      signals.blindSpots.length > 0
        ? `\n\n# What you could NOT see this run (do not guess at these, and do not propose anything that depends on them)\n${signals.blindSpots.map((b) => `- ${b}`).join("\n")}`
        : "";

    const { object, usage } = await generateObject({
      model: await resolveModel(PROPOSE_MODEL),
      schema: proposalSchema,
      system: SYSTEM,
      prompt:
        `Brand: ${brand.name} (${brand.slug})\n\n` +
        `${signals.text}${blindSpotBlock}\n\n` +
        `File at most ${MAX_PROPOSALS_PER_RUN} proposals. Empty is fine.`,
    });

    await logUsage({
      kind: "task",
      model: PROPOSE_MODEL,
      usage,
      userId: null,
      brandId: brand.id,
      teamId: null,
      refId: null,
    });

    if (object.proposals.length === 0) {
      await logWikiActivity({
        brandId: brand.id,
        op: "propose",
        action: "no-proposal",
        detail: object.nothingToPropose || "nothing worth proposing this week",
        meta: { runRef, blindSpots: signals.blindSpots },
        model: PROPOSE_MODEL,
      });
      return { brand: brand.slug, ok: true, filed: 0, skipped: null };
    }

    // Resolve team slugs once.
    const teamRows = await db.select({ id: teams.id, slug: teams.slug }).from(teams);
    const teamBySlug = new Map(teamRows.map((t) => [t.slug, t.id]));

    // Verify every quote against what the model was actually shown. A proposal
    // whose evidence is invented is worse than no proposal, because the quote is
    // exactly what a human trusts to judge it quickly. An unverifiable quote is
    // marked rather than dropped, since the model may have merely tidied
    // whitespace, and the inbox shows the warning.
    const haystack = normalize(signals.text);
    const attributed = signals.attributions.map((a) => ({
      ...a,
      norm: normalize(a.text),
    }));

    /**
     * Whose conversation actually contains this quote.
     *
     * Resolved by matching the text, not by reading the model's `source` field:
     * provenance is exactly the thing a model should not be trusted to self-report,
     * and the same substring match already tells us whether the quote is real.
     */
    const ownerOf = (quote: string) => {
      const nq = normalize(quote);
      return attributed.find((a) => a.norm.includes(nq)) ?? null;
    };

    const rows = object.proposals
      .filter((p) => p.title.trim() && p.body.trim() && p.quotes.length > 0)
      .map((p) => {
        const quotes = p.quotes.map((q) => {
          const owner = ownerOf(q.text);
          return {
            text: q.text.trim(),
            // Replace the model's claimed source with the resolved one where we
            // could resolve it, so the person and date shown are facts.
            source: owner
              ? `${owner.userName} · chat "${owner.title}" · ${owner.day}`
              : q.source.trim(),
            verified: haystack.includes(normalize(q.text)),
            userId: owner?.userId,
            conversationId: owner?.conversationId,
          };
        });
        // The owner is whoever the first resolvable quote belongs to. A proposal
        // with no resolvable quote is organisational (a stale doc, a repeated
        // template) and stays unattributed, which is the honest outcome rather
        // than pinning it on whoever happened to chat most recently.
        const sourceUserId = quotes.find((q) => q.userId)?.userId ?? null;
        return {
          brandId: brand.id,
          teamId: p.teamSlug ? (teamBySlug.get(p.teamSlug) ?? null) : null,
          kind: p.kind,
          title: p.title.trim(),
          body: p.body.trim(),
          evidence: {
            quotes,
            signals: signals.sources,
            blindSpots: signals.blindSpots,
          },
          sourceUserId,
          state: "pending" as const,
          runRef,
        };
      });

    if (rows.length === 0) {
      await logWikiActivity({
        brandId: brand.id,
        op: "propose",
        action: "no-proposal",
        detail: "every candidate lacked a title, body, or quote",
        meta: { runRef },
        model: PROPOSE_MODEL,
      });
      return { brand: brand.slug, ok: true, filed: 0, skipped: null };
    }

    const inserted = await db
      .insert(proposals)
      .values(rows)
      .returning({ id: proposals.id, title: proposals.title });

    const unverified = rows.filter((r) =>
      r.evidence.quotes.some((q) => !q.verified),
    ).length;
    await logWikiActivity({
      brandId: brand.id,
      op: "propose",
      action: "created",
      detail:
        `filed ${inserted.length}: ${inserted.map((i) => i.title).join("; ")}` +
        (unverified ? ` (${unverified} with an unverified quote)` : ""),
      meta: { runRef, blindSpots: signals.blindSpots, unverified },
      model: PROPOSE_MODEL,
    });

    return { brand: brand.slug, ok: true, filed: inserted.length, skipped: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`propose failed for ${brand.slug}`, err);
    await logWikiActivity({
      brandId: brand.id,
      op: "propose",
      action: "error",
      detail: error.slice(0, 500),
      status: "error",
      meta: { runRef },
      model: PROPOSE_MODEL,
    });
    return { brand: brand.slug, ok: false, filed: 0, skipped: null, error };
  }
}

/** The weekly sweep across every brand, each isolated. Called from the cron. */
export async function runWeeklyProposals(runRef?: string): Promise<{
  ok: number;
  failed: number;
  filed: number;
  results: ProposeResult[];
}> {
  const ref = runRef ?? `weekly-${new Date().toISOString().slice(0, 10)}`;
  const all = await db
    .select({ id: brands.id, slug: brands.slug, name: brands.name })
    .from(brands);
  const results: ProposeResult[] = [];
  for (const brand of all) {
    // Structural isolation, matching runWeeklyLint: proposeForBrand catches its
    // own failures, and this makes it impossible for an escape to skip the rest.
    try {
      results.push(await proposeForBrand(brand, ref));
    } catch (err) {
      console.error(`propose threw outside proposeForBrand for ${brand.slug}`, err);
      results.push({
        brand: brand.slug,
        ok: false,
        filed: 0,
        skipped: null,
        error: String(err),
      });
    }
  }
  return {
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    filed: results.reduce((n, r) => n + r.filed, 0),
    results,
  };
}

/** Retire every pending proposal from one pass, e.g. after a bad batch. */
export async function retirePass(runRef: string, reason: string): Promise<number> {
  const rows = await db
    .select({ id: proposals.id })
    .from(proposals)
    .where(and(eq(proposals.runRef, runRef), eq(proposals.state, "pending")))
    .orderBy(desc(proposals.createdAt));
  if (rows.length === 0) return 0;
  await db
    .update(proposals)
    .set({ state: "dismissed", decision: reason, decidedAt: new Date() })
    .where(
      inArray(
        proposals.id,
        rows.map((r) => r.id),
      ),
    );
  return rows.length;
}
