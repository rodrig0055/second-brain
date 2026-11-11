import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations,
  knowledgeDocs,
  messages,
  taskRuns,
} from "@/db/schema";
import type { DbUser } from "@/lib/access";

const LIMIT = 20;

export type SearchResults = {
  conversations: {
    id: string;
    title: string;
    teamSlug: string;
    updatedAt: Date;
  }[];
  runs: {
    id: string;
    templateName: string;
    teamSlug: string;
    brandName: string;
    createdAt: Date;
  }[];
  docs: { id: string; title: string; kind: string }[];
};

/**
 * Access-scoped full-text-ish search (ILIKE) across conversations, task runs,
 * and knowledge docs. Members see only their own chats/runs; docs are
 * admin-only (they're managed under /admin).
 */
export async function search(
  user: DbUser,
  query: string,
): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { conversations: [], runs: [], docs: [] };
  const like = `%${q}%`;
  const isAdmin = user.role === "admin";

  // Conversations: match on title or any message content.
  const convMatchIds = await db
    .selectDistinct({ id: conversations.id })
    .from(conversations)
    .leftJoin(messages, eq(messages.conversationId, conversations.id))
    .where(
      and(
        isAdmin ? undefined : eq(conversations.userId, user.id),
        or(ilike(conversations.title, like), ilike(messages.content, like)),
      ),
    )
    .limit(LIMIT);

  const convRows = convMatchIds.length
    ? await db.query.conversations.findMany({
        where: inArray(
          conversations.id,
          convMatchIds.map((c) => c.id),
        ),
        orderBy: [desc(conversations.updatedAt)],
        with: { team: true },
      })
    : [];

  // Task runs: match on output.
  const runRows = await db.query.taskRuns.findMany({
    where: and(
      isAdmin ? undefined : eq(taskRuns.userId, user.id),
      ilike(taskRuns.output, like),
    ),
    orderBy: [desc(taskRuns.createdAt)],
    limit: LIMIT,
    with: { template: { with: { team: true } }, brand: true },
  });

  // Knowledge docs: admin-only.
  const docRows = isAdmin
    ? await db.query.knowledgeDocs.findMany({
        where: or(ilike(knowledgeDocs.title, like), ilike(knowledgeDocs.content, like)),
        orderBy: [desc(knowledgeDocs.updatedAt)],
        limit: LIMIT,
      })
    : [];

  return {
    conversations: convRows.map((c) => ({
      id: c.id,
      title: c.title,
      teamSlug: c.team.slug,
      updatedAt: c.updatedAt,
    })),
    runs: runRows.map((r) => ({
      id: r.id,
      templateName: r.template.name,
      teamSlug: r.template.team.slug,
      brandName: r.brand.name,
      createdAt: r.createdAt,
    })),
    docs: docRows.map((d) => ({ id: d.id, title: d.title, kind: d.kind })),
  };
}
