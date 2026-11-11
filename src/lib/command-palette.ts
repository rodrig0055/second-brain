import { and, desc, eq, ilike, inArray } from "drizzle-orm";
import { db } from "@/db";
import { brands, conversations, imageTemplates, partners, taskTemplates } from "@/db/schema";
import { getUserTeams, type DbUser } from "@/lib/access";
import { PARTNERSHIPS_TEAM_SLUG } from "@/lib/workspaces";
import { partnerPath } from "@/lib/partners/gate";
import { PARTNERS_BRAND_SLUG } from "@/lib/partners/model";

/** One palette row the server found: a record the person can open. */
export type PaletteHit = { id: string; label: string; href: string; group: string; hint?: string };

const PER_GROUP = 5;

/**
 * Records for the command palette, scoped exactly like the pages they open:
 * - Chats: the person's own conversations (the chat page shows no one else's).
 * - Task templates: active templates of teams the person can open.
 * - Image templates: shared by everyone, as on /images/templates.
 * - Partners: only with access to the Partnerships team, and only the tracker's brand.
 *
 * Title-only matching keeps it fast enough to run on every keystroke; /search is the full-text
 * answer. An empty query returns recent chats, so the palette has something useful before typing.
 */
export async function paletteHits(user: DbUser, query: string): Promise<PaletteHit[]> {
  const q = query.trim().slice(0, 100);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

  const chats = await db.query.conversations.findMany({
    where: and(eq(conversations.userId, user.id), q ? ilike(conversations.title, like) : undefined),
    orderBy: [desc(conversations.updatedAt)],
    limit: PER_GROUP,
    columns: { id: true, title: true },
  });
  const hits: PaletteHit[] = chats.map((c) => ({
    id: `chat:${c.id}`,
    label: c.title || "Untitled chat",
    href: `/chat/${c.id}`,
    group: q ? "Chats" : "Recent chats",
  }));
  if (!q) return hits;

  const teams = await getUserTeams(user);
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const canPartners = teams.some((t) => t.slug === PARTNERSHIPS_TEAM_SLUG);

  const [tasks, images, partnerRows] = await Promise.all([
    teams.length
      ? db.query.taskTemplates.findMany({
          where: and(
            inArray(
              taskTemplates.teamId,
              teams.map((t) => t.id),
            ),
            eq(taskTemplates.isActive, true),
            ilike(taskTemplates.name, like),
          ),
          limit: PER_GROUP,
          columns: { id: true, name: true, teamId: true },
        })
      : [],
    db.query.imageTemplates.findMany({
      where: ilike(imageTemplates.name, like),
      orderBy: [desc(imageTemplates.createdAt)],
      limit: PER_GROUP,
      columns: { id: true, name: true },
    }),
    canPartners ? findPartners(like) : [],
  ]);

  for (const t of tasks) {
    const team = teamById.get(t.teamId);
    if (!team) continue;
    hits.push({ id: `task:${t.id}`, label: t.name, href: `/t/${team.slug}/tasks/${t.id}`, group: "Task templates", hint: team.name });
  }
  for (const t of images) {
    hits.push({ id: `image:${t.id}`, label: t.name, href: `/images/templates/${t.id}`, group: "Image templates" });
  }
  for (const p of partnerRows) {
    hits.push({ id: `partner:${p.id}`, label: p.name, href: partnerPath(p.id), group: "Partners" });
  }
  return hits;
}

async function findPartners(like: string) {
  const brand = await db.query.brands.findFirst({ where: eq(brands.slug, PARTNERS_BRAND_SLUG), columns: { id: true } });
  if (!brand) return [];
  return db.query.partners.findMany({
    where: and(eq(partners.brandId, brand.id), ilike(partners.name, like)),
    limit: PER_GROUP,
    columns: { id: true, name: true },
  });
}
