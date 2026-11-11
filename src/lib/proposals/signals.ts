import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  calendarEvents,
  conversations,
  integrationConnections,
  knowledgeDocs,
  messages,
  proposals,
  syncRuns,
  taskRuns,
  taskTemplates,
} from "@/db/schema";

/**
 * Gather the week's signals for one brand.
 *
 * Two rules govern everything here, and both come from the same place: a
 * proposal is only as good as the evidence under it.
 *
 * 1. **Carry the real words.** Conversation text goes in verbatim, not
 *    summarised. "The team wanted better reporting" is not something anyone can
 *    act on; the sentence they actually typed is.
 * 2. **Name what could not be seen.** A source that is not connected, or whose
 *    sync is failing, is recorded as a blind spot rather than quietly treated as
 *    "nothing happened". Silence and absence look identical downstream, and
 *    conflating them is how a brain starts inventing.
 */

/**
 * One conversation's worth of text, kept alongside who wrote it.
 *
 * This is what makes a proposal reachable by the person who caused it. The model
 * is asked to name its source, but a model's claim about provenance is exactly
 * the kind of thing not to trust: attribution is resolved by finding which
 * conversation's text actually contains the quote, reusing the same match that
 * verifies the quote is real in the first place.
 */
export type SignalAttribution = {
  conversationId: string;
  userId: string;
  userName: string;
  title: string;
  day: string;
  /** The user-authored text from this conversation, for matching. */
  text: string;
};

export type BrandSignals = {
  /** The prompt-ready text the model reads. */
  text: string;
  /** Sources that could not be read this run, stated plainly. */
  blindSpots: string[];
  /** Short labels of what was read, for the proposal's provenance. */
  sources: string[];
  /** Every verbatim body the model saw, for quote verification. */
  corpus: string;
  /** Who said what, so a proposal can be attributed to a person. */
  attributions: SignalAttribution[];
  /** True when there is genuinely nothing to reason about. */
  empty: boolean;
};

/**
 * Lookback window, deliberately wider than the weekly cadence.
 *
 * With a 7-day window a weekly pass sees nothing whenever the team had a quiet
 * week, which is precisely when a proactive nudge is worth most. Overlapping the
 * window with the cadence also means a signal cannot fall through the gap if a
 * run is missed. Re-proposal is prevented by the prior-proposals list, not by a
 * tight window, so the overlap costs nothing.
 */
const DAYS = 14;
const MAX_CONVERSATIONS = 12;
const MAX_MESSAGES_PER_CONVERSATION = 8;
const MAX_MESSAGE_CHARS = 1200;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function gatherBrandSignals(brand: {
  id: string;
  slug: string;
  name: string;
}): Promise<BrandSignals> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - DAYS);

  const sections: string[] = [];
  const blindSpots: string[] = [];
  const sources: string[] = [];
  const corpusParts: string[] = [];
  const attributions: SignalAttribution[] = [];

  // ---- 1. Conversations: the richest signal, and the only one that carries
  // what the team actually said. Read verbatim.
  const convs = await db.query.conversations.findMany({
    where: and(
      eq(conversations.brandId, brand.id),
      gte(conversations.updatedAt, since),
    ),
    with: { team: true, user: true },
    orderBy: [desc(conversations.updatedAt)],
    limit: MAX_CONVERSATIONS,
  });

  if (convs.length > 0) {
    const lines: string[] = [];
    for (const c of convs) {
      const msgs = await db.query.messages.findMany({
        where: eq(messages.conversationId, c.id),
        orderBy: [desc(messages.createdAt)],
        limit: MAX_MESSAGES_PER_CONVERSATION,
      });
      if (msgs.length === 0) continue;
      const day = c.updatedAt.toISOString().slice(0, 10);
      lines.push(
        `## Chat "${c.title}" (${c.team?.name ?? "unknown team"}, ${day})`,
      );
      const own: string[] = [];
      for (const m of msgs.reverse()) {
        const body = clip(m.content.trim(), MAX_MESSAGE_CHARS);
        if (!body) continue;
        lines.push(`${m.role.toUpperCase()}: ${body}`);
        own.push(body);
        if (m.role === "user") corpusParts.push(body);
      }
      // Both sides go in the attribution text: a proposal is just as often
      // evidenced by what the assistant reported as by what the person asked,
      // and either way it is this person's thread and their thing to act on.
      attributions.push({
        conversationId: c.id,
        userId: c.userId,
        userName: c.user?.name ?? c.user?.email ?? "someone",
        title: c.title,
        day,
        text: own.join("\n"),
      });
    }
    if (lines.length > 0) {
      sections.push(`# Conversations this week (verbatim)\n${lines.join("\n")}`);
      sources.push(`${convs.length} conversation(s)`);
    }
  } else {
    blindSpots.push("Nobody chatted about this brand this week, so there is no team signal to read.");
  }

  // ---- 2. Task runs: what the team asked for repeatedly. A task run by hand
  // three times is the clearest signal a schedule or template is missing.
  const runs = await db
    .select({
      name: taskTemplates.name,
      templateId: taskRuns.templateId,
      n: sql<number>`count(*)::int`,
      lastAt: sql<Date>`max(${taskRuns.createdAt})`,
    })
    .from(taskRuns)
    .innerJoin(taskTemplates, eq(taskRuns.templateId, taskTemplates.id))
    .where(and(eq(taskRuns.brandId, brand.id), gte(taskRuns.createdAt, since)))
    .groupBy(taskTemplates.name, taskRuns.templateId)
    .orderBy(desc(sql`count(*)`));

  if (runs.length > 0) {
    sections.push(
      `# Tasks run this week\n${runs
        .map((r) => `- "${r.name}" run ${r.n} time(s), last ${new Date(r.lastAt).toISOString().slice(0, 10)}`)
        .join("\n")}`,
    );
    sources.push(`${runs.length} template(s) used`);
  }

  // ---- 3. Data health. A failing sync is a blind spot, not a quiet zero, and
  // saying so is the difference between "no spend" and "we cannot see spend".
  const conns = await db.query.integrationConnections.findMany({
    where: eq(integrationConnections.brandId, brand.id),
  });
  const connected = conns.filter((c) => c.status === "connected");
  for (const c of conns) {
    if (c.status === "error") {
      blindSpots.push(
        `${c.platform} sync is failing (${c.failureKind ?? "unknown"}), so its data is missing or stale.`,
      );
    } else if (c.status === "disconnected") {
      blindSpots.push(`${c.platform} is disconnected.`);
    }
  }
  if (connected.length > 0) {
    sources.push(`${connected.map((c) => c.platform).join(", ")} connected`);
  } else {
    blindSpots.push(
      "No integrations are connected for this brand, so nothing about its live performance can be read.",
    );
  }

  const failures = await db
    .select({
      platform: syncRuns.platform,
      kind: syncRuns.failureKind,
      action: syncRuns.recoveryAction,
      n: sql<number>`count(*)::int`,
    })
    .from(syncRuns)
    .where(
      and(
        eq(syncRuns.brandId, brand.id),
        gte(syncRuns.startedAt, since),
        eq(syncRuns.status, "error"),
      ),
    )
    .groupBy(syncRuns.platform, syncRuns.failureKind, syncRuns.recoveryAction);
  if (failures.length > 0) {
    sections.push(
      `# Sync failures this week\n${failures
        .map((f) => `- ${f.platform}: ${f.n}x ${f.kind ?? "error"}${f.action ? ` — ${f.action}` : ""}`)
        .join("\n")}`,
    );
  }

  // ---- 4. What the brain already knows, so nothing already captured is
  // proposed as news.
  const docs = await db.query.knowledgeDocs.findMany({
    where: and(
      eq(knowledgeDocs.isActive, true),
      or(eq(knowledgeDocs.brandId, brand.id), isNull(knowledgeDocs.brandId)),
    ),
    columns: { title: true, kind: true },
  });
  if (docs.length > 0) {
    sections.push(
      `# Knowledge the brain already holds (do not propose adding these again)\n${docs
        .map((d) => `- [${d.kind}] ${d.title}`)
        .join("\n")}`,
    );
  }

  const templates = await db.query.taskTemplates.findMany({
    where: eq(taskTemplates.isActive, true),
    columns: { name: true },
  });
  if (templates.length > 0) {
    sections.push(
      `# Templates that already exist (do not propose creating these again)\n${templates
        .map((t) => `- ${t.name}`)
        .join("\n")}`,
    );
  }

  // ---- 5. Proposals already on the table, including dismissed ones. A
  // rejected proposal that comes back every week trains people to ignore the
  // inbox, so the pass has to see what was already declined and why.
  const prior = await db.query.proposals.findMany({
    where: eq(proposals.brandId, brand.id),
    columns: { title: true, state: true, decision: true, kind: true },
    orderBy: [desc(proposals.createdAt)],
    limit: 40,
  });
  if (prior.length > 0) {
    sections.push(
      `# Proposals already filed (never repeat one; a dismissed idea stays dismissed unless genuinely new evidence appeared)\n${prior
        .map(
          (p) =>
            `- [${p.state}] (${p.kind}) ${p.title}${p.state === "dismissed" && p.decision ? ` — declined because: ${p.decision}` : ""}`,
        )
        .join("\n")}`,
    );
  }

  // ---- 6. Calendar: what is coming, so a proposal can be timely.
  const events = await db.query.calendarEvents.findMany({
    where: eq(calendarEvents.isActive, true),
  });
  const upcoming = events.filter(
    (e) => e.brandIds.length === 0 || e.brandIds.includes(brand.id),
  );
  if (upcoming.length > 0) {
    sections.push(
      `# Commercial calendar\n${upcoming
        .map((e) => `- ${e.name} (${e.date}${e.recurring ? ", recurring" : ""})${e.notes ? ` — ${e.notes}` : ""}`)
        .join("\n")}`,
    );
  }

  return {
    text: sections.join("\n\n"),
    blindSpots,
    sources,
    corpus: corpusParts.join("\n"),
    attributions,
    // Only the team's own activity can justify a proposal. Without a
    // conversation or a task run, everything else here is just inventory, and
    // proposing from inventory alone produces generic marketing advice.
    empty: convs.length === 0 && runs.length === 0,
  };
}
