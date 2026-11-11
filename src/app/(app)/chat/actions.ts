"use server";

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, messages, taskRuns } from "@/db/schema";
import { requireBrand, requireTeam, requireUser } from "@/lib/access";
import { reportSchema } from "@/lib/reports/schema";
import { reportToMarkdown } from "@/lib/reports/to-markdown";

export async function createConversation(formData: FormData) {
  const teamSlug = String(formData.get("teamSlug") ?? "");
  const brandId = String(formData.get("brandId") ?? "");

  // 404s if the user has no access to the selected team or brand.
  const { user, team } = await requireTeam(teamSlug);
  const { brand } = await requireBrand(brandId);

  const [conv] = await db
    .insert(conversations)
    .values({ userId: user.id, teamId: team.id, brandId: brand.id })
    .returning();

  redirect(`/chat/${conv.id}`);
}

/**
 * Spins up a chat seeded with a finished task run so the user can keep iterating
 * on the output (only for markdown runs — report/KPI templates stay one-shot).
 * The task inputs become the opening user turn and the run output the assistant
 * turn, so /api/chat replays them as history and the agent lands mid-context.
 */
export async function startChatFromRun(formData: FormData) {
  const runId = String(formData.get("runId") ?? "");

  const run = await db.query.taskRuns.findFirst({
    where: eq(taskRuns.id, runId),
    with: { template: { with: { team: true } } },
  });
  if (!run) notFound();

  // Same access rules as the run detail page: team access + owner-or-admin.
  const { user, team } = await requireTeam(run.template.team.slug);
  if (run.template.teamId !== team.id || (run.userId !== user.id && user.role !== "admin")) {
    notFound();
  }
  await requireBrand(run.brandId);

  // Guard: only completed runs with output are chat-continuable.
  if (run.status !== "done" || !run.output.trim()) {
    redirect(`/t/${team.slug}/runs/${run.id}`);
  }

  // Report templates store JSON; render it to readable markdown so the seeded
  // chat message reads naturally instead of showing a raw object.
  let outputForChat = run.output;
  if (run.template.renderAs === "report") {
    try {
      const parsed = reportSchema.safeParse(JSON.parse(run.output));
      if (parsed.success) outputForChat = reportToMarkdown(parsed.data);
    } catch {
      // leave outputForChat as the raw string
    }
  }

  const inputsSummary = Object.entries(run.inputs)
    .filter(([, v]) => v && v !== "(not provided)")
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const userSeed = [
    `Let's continue working on my **${run.template.name}** task.`,
    run.template.description ? `\n\n_${run.template.description}_` : "",
    inputsSummary ? `\n\n**Inputs I used:**\n${inputsSummary}` : "",
    `\n\nThe output it produced is below — help me refine and iterate on it.`,
  ].join("");

  const [conv] = await db
    .insert(conversations)
    .values({
      userId: user.id,
      teamId: run.template.teamId,
      brandId: run.brandId,
      model: run.model,
      title: run.template.name.slice(0, 120),
    })
    .returning();

  // Explicit timestamps keep the seed turns ordered (the chat page sorts by
  // createdAt; a batch insert would otherwise share one default timestamp).
  const now = Date.now();
  await db.insert(messages).values([
    { conversationId: conv.id, role: "user", content: userSeed, createdAt: new Date(now) },
    { conversationId: conv.id, role: "assistant", content: outputForChat, createdAt: new Date(now + 1000) },
  ]);

  redirect(`/chat/${conv.id}`);
}

export async function renameConversation(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const rawTitle = String(formData.get("title") ?? "").trim();
  const user = await requireUser();

  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });
  if (!conv || conv.userId !== user.id) return;

  // Fall back to a default rather than persisting an empty title.
  const title = (rawTitle || "New chat").slice(0, 120);

  await db
    .update(conversations)
    .set({ title, updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));

  revalidatePath("/chat");
  revalidatePath(`/chat/${conversationId}`);
}

export async function deleteConversation(formData: FormData) {
  const conversationId = String(formData.get("conversationId") ?? "");
  const user = await requireUser();

  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, conversationId),
  });
  if (!conv || conv.userId !== user.id) return;

  await db.delete(conversations).where(eq(conversations.id, conversationId));
  revalidatePath("/chat");
}
