import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeDocs } from "@/db/schema";
import { logWikiActivity } from "./shared";

const INDEX_TITLE = "Wiki index";

/** First non-heading, non-empty content line, clamped. Skips any leading
 * OKF-style YAML frontmatter block so the preview shows real content. */
function firstLine(content: string, max = 120): string {
  const body = content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    return line.length > max ? `${line.slice(0, max)}…` : line;
  }
  return "";
}

/**
 * Karpathy's index.md: a deterministic per-brand table of contents over all
 * active knowledge docs — one line each with kind, scope, updated date, and a
 * content preview. No LLM involved. Regenerated after ingest and lint runs.
 * Never injected into prompts (see WIKI_KINDS in src/lib/prompt.ts).
 */
export async function regenerateWikiIndex(brandId: string): Promise<void> {
  const docs = await db.query.knowledgeDocs.findMany({
    where: and(
      eq(knowledgeDocs.brandId, brandId),
      eq(knowledgeDocs.isActive, true),
    ),
    orderBy: [desc(knowledgeDocs.updatedAt)],
    with: { team: true },
  });

  const byKind = new Map<string, typeof docs>();
  for (const d of docs) {
    if (d.kind === "wiki-index") continue; // never index the index
    if (!byKind.has(d.kind)) byKind.set(d.kind, []);
    byKind.get(d.kind)!.push(d);
  }

  const sections: string[] = [];
  for (const [kind, kindDocs] of byKind) {
    const lines = kindDocs.map((d) => {
      const scope = d.team ? `, ${d.team.name}` : "";
      const updated = new Date(d.updatedAt).toISOString().slice(0, 10);
      const preview = firstLine(d.content);
      const ref = d.slug ? `[[${d.slug}]] ` : "";
      const tags =
        d.tags.length > 0 ? `, tags: ${d.tags.join(", ")}` : "";
      return `- ${ref}**${d.title}** (${kind}${scope}${tags}) — updated ${updated}${preview ? ` — ${preview}` : ""}`;
    });
    sections.push(`## ${kind}\n${lines.join("\n")}`);
  }
  const content =
    sections.length > 0
      ? sections.join("\n\n")
      : "(no active knowledge docs)";

  const existing = await db.query.knowledgeDocs.findFirst({
    where: and(
      eq(knowledgeDocs.brandId, brandId),
      eq(knowledgeDocs.kind, "wiki-index"),
      eq(knowledgeDocs.title, INDEX_TITLE),
    ),
  });

  let docId: string;
  if (existing) {
    await db
      .update(knowledgeDocs)
      .set({ content, slug: "wiki-index", updatedAt: new Date() })
      .where(eq(knowledgeDocs.id, existing.id));
    docId = existing.id;
  } else {
    const [row] = await db
      .insert(knowledgeDocs)
      .values({
        brandId,
        teamId: null,
        kind: "wiki-index",
        title: INDEX_TITLE,
        slug: "wiki-index",
        content,
        isActive: true,
        updatedById: null,
      })
      .returning({ id: knowledgeDocs.id });
    docId = row.id;
  }

  await logWikiActivity({
    brandId,
    op: "index",
    action: "regenerated",
    docId,
    detail: `${docs.length} active docs indexed`,
    model: null,
  });
}
