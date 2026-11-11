import { tool } from "ai";
import { z } from "zod";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeDocs, teams } from "@/db/schema";
import type { ToolBrand } from "@/lib/integrations/types";

/** Strip a leading OKF-style YAML frontmatter block (mirrors prompt.ts). */
function stripFrontmatter(content: string): string {
  return content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * `load_skill` — on-demand retrieval of a "skill" knowledge doc (a reusable
 * step-by-step procedure). buildSystemPrompt injects only a compact index of
 * skill titles + triggers; when a request matches one, the agent calls this to
 * read the full body instead of every skill being stuffed into every prompt.
 * Scoped to the brand (brand-specific or global) and team (team-specific or
 * brand-wide), mirroring how buildSystemPrompt scopes docs.
 */
export function skillTools(brand: ToolBrand, teamSlug?: string) {
  return {
    load_skill: tool({
      description:
        "Load the full step-by-step instructions of a skill by its slug. Call this when the user's request matches a skill listed in the Skills index (or when the user says 'use the <name> skill') BEFORE doing the work, then follow the returned steps. Returns the skill's title and body.",
      inputSchema: z.object({
        slug: z
          .string()
          .describe("The exact skill slug from the Skills index, e.g. 'brand-voice-check'."),
      }),
      execute: async ({ slug }) => {
        // Resolve the team id from its slug so team-scoped skills match.
        const team = teamSlug
          ? await db.query.teams.findFirst({ where: eq(teams.slug, teamSlug) })
          : null;

        const rows = await db.query.knowledgeDocs.findMany({
          where: and(
            eq(knowledgeDocs.kind, "skill"),
            eq(knowledgeDocs.isActive, true),
            eq(knowledgeDocs.slug, slug),
            or(eq(knowledgeDocs.brandId, brand.id), isNull(knowledgeDocs.brandId)),
            team
              ? or(eq(knowledgeDocs.teamId, team.id), isNull(knowledgeDocs.teamId))
              : isNull(knowledgeDocs.teamId),
          ),
        });
        // Prefer the most specific match (brand+team) over a global one.
        const doc =
          rows.find((r) => r.brandId === brand.id && r.teamId === (team?.id ?? null)) ??
          rows.find((r) => r.brandId === brand.id) ??
          rows[0];

        if (!doc) {
          return { error: `No skill found with slug "${slug}" for this brand/team.` };
        }
        return { title: doc.title, content: stripFrontmatter(doc.content) };
      },
    }),
  };
}

/**
 * `knowledge_read` — on-demand retrieval of any other knowledge doc by slug.
 *
 * The sibling of load_skill, for the docs the system prompt lists but does not
 * include: winners and lessons past their injection caps, and anything else the
 * catalog names. Without it the catalog would be a menu with no kitchen.
 *
 * This is the growth path that keeps the no-RAG design viable — as the brain
 * accumulates docs, more of them move from "injected into every prompt" to
 * "listed in the catalog, read when relevant", and the prompt does not grow.
 */
export function knowledgeTools(brand: ToolBrand, teamSlug?: string) {
  return {
    knowledge_read: tool({
      description:
        "Read the full text of a knowledge doc by its slug, using the slugs listed in the 'Other knowledge docs' catalog. Use it when the catalog names something relevant to the question that was not already included in your context. Returns the doc's title, kind, and body.",
      inputSchema: z.object({
        slug: z
          .string()
          .describe("The exact slug from the knowledge docs catalog."),
      }),
      execute: async ({ slug }) => {
        const team = teamSlug
          ? await db.query.teams.findFirst({ where: eq(teams.slug, teamSlug) })
          : null;

        const rows = await db.query.knowledgeDocs.findMany({
          where: and(
            eq(knowledgeDocs.isActive, true),
            eq(knowledgeDocs.slug, slug),
            // Unreviewed and retired lessons are withheld from the prompt on
            // purpose; a read tool that returned them would route straight
            // around the review gate.
            eq(knowledgeDocs.reviewState, "approved"),
            or(eq(knowledgeDocs.brandId, brand.id), isNull(knowledgeDocs.brandId)),
            team
              ? or(eq(knowledgeDocs.teamId, team.id), isNull(knowledgeDocs.teamId))
              : isNull(knowledgeDocs.teamId),
          ),
        });
        const doc =
          rows.find((r) => r.brandId === brand.id && r.teamId === (team?.id ?? null)) ??
          rows.find((r) => r.brandId === brand.id) ??
          rows[0];

        if (!doc) {
          return {
            error: `No knowledge doc found with slug "${slug}" for this brand/team.`,
          };
        }
        return {
          title: doc.title,
          kind: doc.kind,
          asOf: (doc.verifiedAt ?? doc.updatedAt).toISOString().slice(0, 10),
          content: stripFrontmatter(doc.content),
        };
      },
    }),
  };
}
