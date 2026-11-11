import { generateObject } from "ai";
import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { resolveModel, PASS_MODELS } from "@/lib/models";
import { buildSystemPrompt } from "@/lib/prompt";
import { logUsage } from "@/lib/usage";
import {
  DEFAULT_LINT_CONFIG,
  lintContent,
  type LintConfig,
  type LintFinding,
  type LintResult,
} from "./lint";

/**
 * The review gate — an independent pass over a finished draft.
 *
 * Two properties do the work here, and both are structural rather than a matter
 * of prompting harder:
 *
 * 1. **The reviewer is not the writer.** It runs in a fresh context that never
 *    saw the draft being produced, so it has nothing invested in it. Asking the
 *    writer to check its own work returns "looks good" almost every time.
 * 2. **The mechanical layer runs first and hands over evidence, not a verdict.**
 *    The reviewer judges the lint's findings rather than re-deriving them, so a
 *    character count is never a matter of opinion and a false positive is never
 *    silently obeyed.
 *
 * The reviewer DOES get the brand's knowledge docs, because verifying a claim
 * needs the brand truth to verify it against. It costs almost nothing: the
 * system prompt is the same cached prefix the writer used. What it never gets is
 * the writer's reasoning.
 */

// Judgment matters more than speed here, so this is a step up from the
// flash-lite used for background distillation. A reviewer that misses a wrong
// price is worse than no reviewer, because the receipt implies it was checked.
export const REVIEW_MODEL = PASS_MODELS.review;

/** One regeneration, then stop. See runReviewedGeneration. */
export const MAX_REVIEW_ROUNDS = 2;

const reviewSchema = z.object({
  verdict: z
    .enum(["ships", "revise"])
    .describe(
      "'ships' only if there is no wrong fact and no unresolved error-level finding. Anything less is 'revise'. Do not soften a fact problem because the writing is good.",
    ),
  factChecks: z
    .array(
      z.object({
        fact: z.string().describe("The figure or claim, quoted from the draft."),
        status: z
          .enum(["verified", "unverifiable", "wrong"])
          .describe(
            "'verified' = supported by the brand docs. 'wrong' = contradicted by them. 'unverifiable' = the docs simply do not say, which is NOT the same as wrong.",
          ),
        note: z.string().describe("One line: what supports or contradicts it."),
      }),
    )
    .describe(
      "Every number, price, percentage, date, and factual claim in the draft. This is the part that must be right.",
    ),
  findings: z
    .array(
      z.object({
        severity: z.enum(["error", "warn"]),
        rule: z
          .string()
          .describe(
            "The rule or brand doc this violates, named. A finding that cannot name what it violates is your opinion, not a finding.",
          ),
        quote: z.string().describe("The offending text, quoted exactly."),
        why: z.string().describe("One line: why it is wrong."),
        fix: z
          .string()
          .describe("The corrected text, in the brand's own register."),
      }),
    )
    .describe("Problems that must change before this ships."),
  keptFlags: z
    .array(
      z.object({
        quote: z.string(),
        why: z
          .string()
          .describe(
            "Why the mechanical flag is a false positive here: a sourced customer quote, or a pattern the brand genuinely uses.",
          ),
      }),
    )
    .describe("Lint flags you judged NOT to be real problems, with the reason."),
  unlabelledVoiceLines: z
    .array(z.string())
    .describe(
      "Customer-voice lines (a review, a comment, a testimonial) that read authentic but trace to no source. These are NOT fabrications and must not drive a 'revise' verdict on their own — list them so the draft can label them illustrative and nobody runs an invented quote as real.",
    ),
  summary: z
    .string()
    .describe("Two sentences at most: what you checked and what you found."),
});

export type ReviewJudgment = z.infer<typeof reviewSchema>;

export type ReviewResult = {
  verdict: "ships" | "revise";
  rounds: number;
  lint: { errorCount: number; warnCount: number; findings: LintFinding[] };
  judgment: ReviewJudgment | null;
  /** Set when the reviewer itself failed; the draft is delivered unreviewed. */
  error?: string;
  model: string;
};

/**
 * Assemble the lint config for a brand.
 *
 * Brand-specific rules live in doc `metadata` rather than a dedicated table, so
 * a brand opts in by adding `{"bannedTerms": [...]}` or `{"metaTitleMax": 60}`
 * to any of its active docs. No migration, and the rule sits beside the brand
 * knowledge that explains it.
 */
export async function loadLintConfig(
  brandId: string,
  teamId?: string | null,
): Promise<LintConfig> {
  const docs = await db.query.knowledgeDocs.findMany({
    where: and(
      eq(knowledgeDocs.isActive, true),
      or(eq(knowledgeDocs.brandId, brandId), isNull(knowledgeDocs.brandId)),
      teamId
        ? or(eq(knowledgeDocs.teamId, teamId), isNull(knowledgeDocs.teamId))
        : isNull(knowledgeDocs.teamId),
    ),
    columns: { metadata: true },
  });

  const banned = new Set<string>();
  let metaTitleMax = DEFAULT_LINT_CONFIG.metaTitleMax;
  let metaDescriptionMax = DEFAULT_LINT_CONFIG.metaDescriptionMax;

  for (const d of docs) {
    const meta = d.metadata ?? {};
    if (Array.isArray(meta.bannedTerms)) {
      for (const t of meta.bannedTerms) {
        if (typeof t === "string" && t.trim()) banned.add(t.trim());
      }
    }
    // A brand-set limit is the brand speaking, so the tighter value wins: two
    // docs disagreeing must not quietly relax a cap.
    if (typeof meta.metaTitleMax === "number" && meta.metaTitleMax > 0) {
      metaTitleMax = Math.min(metaTitleMax, meta.metaTitleMax);
    }
    if (typeof meta.metaDescriptionMax === "number" && meta.metaDescriptionMax > 0) {
      metaDescriptionMax = Math.min(metaDescriptionMax, meta.metaDescriptionMax);
    }
  }

  return {
    ...DEFAULT_LINT_CONFIG,
    bannedTerms: [...banned],
    metaTitleMax,
    metaDescriptionMax,
  };
}

const REVIEWER_CONTRACT = `You are reviewing a finished draft that you did not write, and you will not be asked to rewrite it wholesale. Judge it the way a careful editor would before it goes to a customer.

**Check facts, not flavour.** This is the line that matters.
- A number, price, spec, date, or named result must be right, and it must be supported by the brand knowledge above. A wrong figure is wrong however well the copy reads. That is the bounce this gate exists for.
- "The brand docs do not mention it" is **unverifiable**, not **wrong**. Do not report an absence as a contradiction.
- A customer-voice line (a review, a comment, a testimonial) that reads authentic but traces to no source is NOT a fabrication. Put it in unlabelledVoiceLines so it can be labelled illustrative. Never let it alone drive a 'revise'.

**Every finding must name the rule or the brand doc it violates.** A finding that cannot name what it breaks is your taste, not a defect, and does not belong in the list. Where the brand's guidance leaves a genuine judgment call, the writer's call stands even when you would have chosen differently. You are the reviewer, not a second author.

**Judge the mechanical findings, do not re-derive them.** A deterministic lint has already run and its findings are listed below. For each one decide: real problem, or false positive? A banned term inside a sourced customer quote is a false positive; put it in keptFlags with the reason. A character count is not a matter of opinion, so an error-level length or placeholder finding stands unless the quoted text is genuinely not what the lint thought it was.

**Fix lines, never strategy.** Offer a corrected line in the brand's own register. Do not restructure the argument, change the offer, or alter a sourced quote. Do not swap a flagged word for a thesaurus synonym, which trades one tell for another; say the plain thing the way this brand says it.

**Never write a customer's words for them.** This is absolute, and it is the one way a reviewer can do more damage than the draft it is reviewing. If the problem is inside a quoted review, comment, or testimonial, your only permitted fixes are to remove the quote, or to describe in the \`fix\` field what a real sourced quote would need to say so a human can go find one. Never invent a replacement quote, never rephrase a customer's sentence into a better one, and never put a claim in a customer's mouth. A fabricated testimonial shipped as real is worse than any wording problem you were asked to catch.

**A fix may not introduce a new fact.** Your corrected line uses only what the draft or the brand knowledge already supports. If a line cannot be fixed without a figure you do not have, say that instead of supplying one.`;

const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A quoted span, in any quote style a model might emit: straight, curly single
 * and double, and guillemets. Written with \u escapes on purpose — see the note
 * in sanitizeFixes.
 */
const QUOTE_CHARS = "\"'\\u201C\\u201D\\u2018\\u2019\\u00AB\\u00BB";
const QUOTED_SPAN = new RegExp(
  `[${QUOTE_CHARS}]([^${QUOTE_CHARS}]{12,400})[${QUOTE_CHARS}]`,
  "g",
);

/**
 * Strip any suggested fix that invents quoted text.
 *
 * Telling the reviewer not to write a customer's words is necessary and not
 * sufficient: asked for a corrected line, a model will cheerfully compose a
 * better-sounding testimonial, and a regeneration would then ship a fabricated
 * review as real. That is the one way this gate could do more harm than the
 * draft it is checking, so the guarantee is enforced here rather than trusted.
 *
 * The rule: a quoted span of four or more words in a `fix` must already appear
 * in the draft. If it does not, the fix is replaced with an instruction to find
 * a real source. The finding itself survives — only the invented remedy is
 * dropped.
 */
export function sanitizeFixes(judgment: ReviewJudgment, draft: string): {
  judgment: ReviewJudgment;
  strippedFixes: number;
} {
  const haystack = normalize(draft);
  let stripped = 0;
  const findings = judgment.findings.map((f) => {
    // Explicit escapes, never literal quote glyphs: a literal “ ” in this class
    // gets normalised to a straight quote by an editor or a copy-paste, and the
    // guard then silently stops catching curly-quoted inventions. That exact bug
    // shipped in the first version of this function.
    const quoted = [...f.fix.matchAll(QUOTED_SPAN)]
      .map((m) => m[1])
      .filter((q) => q.trim().split(/\s+/).length >= 4);
    const invented = quoted.filter((q) => !haystack.includes(normalize(q)));
    if (invented.length === 0) return f;
    stripped++;
    return {
      ...f,
      fix:
        "The reviewer proposed a replacement quote that does not appear in the draft, so it was removed. " +
        "Delete the quoted line, or replace it with a real sourced quote a human has verified. " +
        "Do not write one.",
    };
  });
  return { judgment: { ...judgment, findings }, strippedFixes: stripped };
}

/** Run the gate once over a draft. Never throws. */
export async function reviewDraft(args: {
  draft: string;
  task: string;
  brandId: string;
  teamId: string;
  userId?: string | null;
  refId?: string | null;
  config?: LintConfig;
}): Promise<ReviewResult> {
  const config = args.config ?? (await loadLintConfig(args.brandId, args.teamId));
  const lint: LintResult = lintContent(args.draft, config);
  const base = {
    rounds: 1,
    lint: {
      errorCount: lint.errorCount,
      warnCount: lint.warnCount,
      findings: lint.findings,
    },
    model: REVIEW_MODEL,
  };

  try {
    // The same system prompt the writer used: it is the brand truth the fact
    // check needs, and it is already in every provider's prompt cache.
    const system = await buildSystemPrompt(args.brandId, args.teamId);

    const lintBlock =
      lint.findings.length > 0
        ? lint.findings
            .map(
              (f) =>
                `- [${f.severity}] ${f.rule} (line ${f.line ?? "?"}): ${f.message}\n  text: ${f.excerpt}`,
            )
            .join("\n")
        : "(none)";
    const factBlock =
      lint.facts.length > 0
        ? lint.facts.map((f) => `- line ${f.line}: ${f.text}`).join("\n")
        : "(none found)";

    const { object, usage } = await generateObject({
      model: await resolveModel(REVIEW_MODEL),
      schema: reviewSchema,
      system,
      prompt:
        `${REVIEWER_CONTRACT}\n\n` +
        `# The task the draft was written for\n${args.task}\n\n` +
        `# Mechanical findings to judge\n${lintBlock}\n\n` +
        `# Figures and dates found in the draft — check each one\n${factBlock}\n\n` +
        `# The draft\n${args.draft}\n\n` +
        `Review it now.`,
    });

    await logUsage({
      kind: "task",
      model: REVIEW_MODEL,
      usage,
      userId: args.userId ?? null,
      brandId: args.brandId,
      teamId: args.teamId,
      refId: args.refId ?? null,
    });

    const { judgment, strippedFixes } = sanitizeFixes(object, args.draft);
    if (strippedFixes > 0) {
      console.warn(
        `reviewDraft: dropped ${strippedFixes} suggested fix(es) that invented a quote`,
      );
    }

    // The mechanical layer has the final say on error-level findings the
    // reviewer neither fixed nor explicitly excused. Otherwise a reviewer that
    // simply ignored a 61-character title would let it ship, and the receipt
    // would claim the draft was checked.
    const excused = new Set(
      judgment.keptFlags.map((k) => k.quote.trim().toLowerCase()),
    );
    const addressed = new Set(
      judgment.findings.map((f) => f.quote.trim().toLowerCase()),
    );
    const unhandledErrors = lint.findings.filter(
      (f) =>
        f.severity === "error" &&
        !excused.has(f.excerpt.trim().toLowerCase()) &&
        !addressed.has(f.excerpt.trim().toLowerCase()),
    );

    const hasWrongFact = judgment.factChecks.some((f) => f.status === "wrong");
    const hasErrorFinding = judgment.findings.some((f) => f.severity === "error");
    const verdict: "ships" | "revise" =
      hasWrongFact || hasErrorFinding || unhandledErrors.length > 0
        ? "revise"
        : judgment.verdict;

    return { ...base, verdict, judgment };
  } catch (err) {
    // A broken reviewer must not block delivery, but it must not silently pass
    // either: the verdict records that the check did not happen.
    console.error("reviewDraft failed", err);
    return {
      ...base,
      verdict: lint.errorCount > 0 ? "revise" : "ships",
      judgment: null,
      error: String(err).slice(0, 300),
    };
  }
}

/** A short instruction block appended to the prompt on a regeneration. */
export function revisionInstructions(result: ReviewResult): string {
  const j = result.judgment;
  const lines: string[] = [
    "Your previous draft was reviewed and did not pass. Produce the full corrected version.",
    "Change only what the review names. Keep everything else, including sourced customer language, exactly as it was.",
  ];
  if (j) {
    for (const f of j.factChecks.filter((f) => f.status === "wrong")) {
      lines.push(`- WRONG FACT "${f.fact}": ${f.note}. Correct it or remove the claim.`);
    }
    for (const f of j.findings) {
      lines.push(`- ${f.rule}: "${f.quote}" — ${f.why}. Use: ${f.fix}`);
    }
    if (j.unlabelledVoiceLines.length > 0) {
      lines.push(
        `- Label these as illustrative, not real testimonials: ${j.unlabelledVoiceLines
          .map((l) => `"${l}"`)
          .join(", ")}`,
      );
    }
  }
  for (const f of result.lint.findings.filter((f) => f.severity === "error")) {
    lines.push(`- ${f.rule} (line ${f.line ?? "?"}): ${f.message} Text: ${f.excerpt}`);
  }
  return lines.join("\n");
}

/** The receipt shown with the output. A draft with no receipt was not reviewed. */
export function reviewReceipt(result: ReviewResult): string {
  const head =
    result.verdict === "ships"
      ? "Review: passed"
      : "Review: flagged, and the issues below remain";
  const bits: string[] = [
    `**${head}** (${result.model}, ${result.rounds} round${result.rounds === 1 ? "" : "s"}, ` +
      `${result.lint.errorCount} mechanical error${result.lint.errorCount === 1 ? "" : "s"} / ${result.lint.warnCount} warning${result.lint.warnCount === 1 ? "" : "s"})`,
  ];
  if (result.error) {
    bits.push(`The reviewer failed to run: ${result.error}. Treat this draft as unreviewed.`);
    return bits.join("\n\n");
  }
  const j = result.judgment;
  if (!j) return bits.join("\n\n");
  bits.push(j.summary);
  const wrong = j.factChecks.filter((f) => f.status === "wrong");
  if (wrong.length > 0) {
    bits.push(
      `Facts contradicted by the brand docs:\n${wrong.map((f) => `- "${f.fact}" — ${f.note}`).join("\n")}`,
    );
  }
  if (j.findings.length > 0) {
    bits.push(
      `Still outstanding:\n${j.findings.map((f) => `- ${f.rule}: "${f.quote}" — ${f.why}`).join("\n")}`,
    );
  }
  if (j.keptFlags.length > 0) {
    bits.push(
      `Flags kept deliberately:\n${j.keptFlags.map((k) => `- "${k.quote}" — ${k.why}`).join("\n")}`,
    );
  }
  if (j.unlabelledVoiceLines.length > 0) {
    bits.push(
      `Customer-voice lines with no traced source (label as illustrative, do not run as real testimonials):\n${j.unlabelledVoiceLines.map((l) => `- "${l}"`).join("\n")}`,
    );
  }
  return bits.join("\n\n");
}
