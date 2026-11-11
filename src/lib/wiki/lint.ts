import { generateObject } from "ai";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { brands, knowledgeDocs } from "@/db/schema";
import { resolveModel } from "@/lib/models";
import { logUsage } from "@/lib/usage";
import { regenerateWikiIndex } from "./index-doc";
import {
  logWikiActivity,
  MAX_LINT_DEACTIVATIONS,
  WIKI_MODEL,
} from "./shared";

/**
 * Karpathy's lint: weekly health check over the LLM-owned wiki docs.
 * Auto-apply is deliberately narrow — deactivation only, LLM-owned docs only
 * (kind lesson/wiki-page AND updatedById IS NULL; a human edit takes
 * ownership), max 3 per brand per run. Human-authored kinds are ground truth:
 * they are never written, only flagged for admins in wiki_activity.
 */

const lintSchema = z.object({
  findings: z.array(
    z.object({
      docId: z.string(),
      issue: z.enum(["duplicate", "contradicts-human-doc", "stale", "low-value"]),
      recommendation: z.enum(["deactivate", "flag"]),
      note: z.string().describe("One sentence explaining the finding."),
    }),
  ),
});

const ISSUE_RANK: Record<string, number> = {
  "contradicts-human-doc": 0,
  duplicate: 1,
  stale: 2,
  "low-value": 3,
};

export async function lintBrand(brandId: string): Promise<{
  deactivated: number;
  flagged: number;
}> {
  // Auditable set: LLM-owned, active lesson/wiki-page docs.
  const auditable = await db.query.knowledgeDocs.findMany({
    where: and(
      eq(knowledgeDocs.brandId, brandId),
      eq(knowledgeDocs.isActive, true),
      inArray(knowledgeDocs.kind, ["lesson", "wiki-page"]),
      isNull(knowledgeDocs.updatedById),
    ),
    with: { team: true },
  });
  if (auditable.length === 0) return { deactivated: 0, flagged: 0 };

  // Ground truth context (read-only, clamped).
  const humanDocs = await db.query.knowledgeDocs.findMany({
    where: and(
      eq(knowledgeDocs.brandId, brandId),
      eq(knowledgeDocs.isActive, true),
      inArray(knowledgeDocs.kind, [
        "brand-voice",
        "offer-rules",
        "catalog",
        "playbook",
        "winner",
      ]),
    ),
  });

  const auditableById = new Map(auditable.map((d) => [d.id, d]));
  const list = auditable
    .map(
      (d) =>
        `- id=${d.id} · kind=${d.kind} · team=${d.team?.name ?? "brand-wide"} · updated=${new Date(d.updatedAt).toISOString().slice(0, 10)}\n  title: ${d.title}\n  content: ${d.content.slice(0, 600)}`,
    )
    .join("\n");
  const truth = humanDocs
    .map((d) => `## ${d.title} [${d.kind}]\n${d.content.slice(0, 2000)}`)
    .join("\n\n");

  const model = await resolveModel(WIKI_MODEL);
  const { object, usage } = await generateObject({
    model,
    schema: lintSchema,
    system:
      `You are the weekly health check for an AI assistant's self-authored knowledge ` +
      `(lessons and digest pages). Find real problems only — an empty findings list is a ` +
      `normal, correct outcome.\n\n` +
      `Issues to look for:\n` +
      `- duplicate: two docs teach the same thing (recommend deactivating the OLDER one).\n` +
      `- contradicts-human-doc: a doc conflicts with the human-authored ground truth below ` +
      `(the human doc always wins — recommend deactivating the self-authored doc).\n` +
      `- stale: clearly time-bound content that has expired.\n` +
      `- low-value: a conversation summary or one-off instruction that should never have ` +
      `been stored.\n\n` +
      `Only reference ids from the AUDITABLE list. Use recommendation="flag" when unsure.\n\n` +
      `# Human-authored ground truth (read-only)\n${truth || "(none)"}`,
    prompt: `# Auditable self-authored docs\n${list}\n\nReturn findings (empty array if all healthy).`,
  });
  await logUsage({
    kind: "task",
    model: WIKI_MODEL,
    usage,
    brandId,
  });

  // Sanity guard: a batch condemning most of the set is itself suspect.
  const valid = object.findings.filter((f) => auditableById.has(f.docId));
  const batchSuspect = valid.length > Math.ceil(auditable.length / 2);

  // Rank and apply.
  const ranked = [...valid].sort(
    (a, b) => (ISSUE_RANK[a.issue] ?? 9) - (ISSUE_RANK[b.issue] ?? 9),
  );
  let deactivated = 0;
  let flagged = 0;
  for (const f of ranked) {
    const doc = auditableById.get(f.docId)!;
    const wantsDeactivate =
      !batchSuspect &&
      f.recommendation === "deactivate" &&
      deactivated < MAX_LINT_DEACTIVATIONS &&
      // wiki-page is recreated weekly by ingest; only kill it on contradiction.
      (doc.kind !== "wiki-page" || f.issue === "contradicts-human-doc");

    if (wantsDeactivate) {
      await db
        .update(knowledgeDocs)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(knowledgeDocs.id, f.docId));
      deactivated++;
      await logWikiActivity({
        brandId,
        teamId: doc.teamId,
        op: "lint",
        action: "deactivated",
        docId: f.docId,
        detail: `${f.issue}: ${f.note}`,
        model: WIKI_MODEL,
      });
    } else {
      flagged++;
      await logWikiActivity({
        brandId,
        teamId: doc.teamId,
        op: "lint",
        action: "flagged",
        docId: f.docId,
        detail: `${f.issue}: ${f.note}${batchSuspect ? " (batch exceeded sanity threshold — nothing auto-applied)" : ""}`,
        model: WIKI_MODEL,
      });
    }
  }

  if (deactivated > 0) await regenerateWikiIndex(brandId);
  return { deactivated, flagged };
}

/** Weekly lint across all brands (each isolated). Called from the cron. */
export async function runWeeklyLint(): Promise<{
  ok: number;
  failed: number;
  deactivated: number;
  flagged: number;
}> {
  const all = await db.select({ id: brands.id, slug: brands.slug }).from(brands);
  let ok = 0;
  let failed = 0;
  let deactivated = 0;
  let flagged = 0;
  for (const brand of all) {
    try {
      const r = await lintBrand(brand.id);
      deactivated += r.deactivated;
      flagged += r.flagged;
      ok++;
    } catch (err) {
      failed++;
      console.error(`wiki lint failed for ${brand.slug}`, err);
      await logWikiActivity({
        brandId: brand.id,
        op: "lint",
        action: "error",
        detail: String(err).slice(0, 500),
        status: "error",
        model: WIKI_MODEL,
      });
    }
  }
  return { ok, failed, deactivated, flagged };
}
