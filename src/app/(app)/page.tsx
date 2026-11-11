import Link from "next/link";
import { FileText, MessageSquare } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations, taskRuns } from "@/db/schema";
import { getUserTeams, requireUser } from "@/lib/access";
import { PageHeader } from "@/components/page-header";
import { WorkspaceCard } from "@/components/workspace-card";
import { loadHomeCards } from "@/lib/home-summaries";
import { ForYou } from "@/components/for-you";

export default async function DashboardPage() {
  const user = await requireUser();
  const teams = await getUserTeams(user);
  const cards = await loadHomeCards(user, teams);

  const [recentChats, recentRuns] = await Promise.all([
    db.query.conversations.findMany({
      where: eq(conversations.userId, user.id),
      orderBy: [desc(conversations.updatedAt)],
      limit: 6,
      with: { team: true, brand: true },
    }),
    db.query.taskRuns.findMany({
      where: eq(taskRuns.userId, user.id),
      orderBy: [desc(taskRuns.createdAt)],
      limit: 6,
      with: { template: { with: { team: true } }, brand: true },
    }),
  ]);

  const activity = [
    ...recentChats.map((chat) => ({
      id: `chat-${chat.id}`,
      href: `/chat/${chat.id}`,
      title: chat.title,
      meta: `${chat.team.name} · ${chat.brand.name}`,
      date: chat.updatedAt,
      kind: "Chat" as const,
    })),
    ...recentRuns.map((run) => ({
      id: `run-${run.id}`,
      href: `/t/${run.template.team.slug}/runs/${run.id}`,
      title: run.template.name,
      meta: `${run.template.team.name} · ${run.brand.name}`,
      date: run.createdAt,
      kind: "Output" as const,
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 8);

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader
        title={`Welcome back${user.name ? `, ${user.name.split(" ")[0]}` : ""}`}
        description="Open a workspace or continue where you left off."
      />

      {teams.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
          You do not have team access yet. Ask an admin to add you to a workspace.
        </div>
      ) : (
        <section aria-labelledby="teams-heading">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="teams-heading" className="text-sm font-semibold text-zinc-800">
              Your workspaces
            </h2>
            <span className="text-xs tabular-nums text-zinc-400">{teams.length}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <WorkspaceCard key={card.team.id} card={card} />
            ))}
          </div>
        </section>
      )}

      <ForYou userId={user.id} />

      <section className="mt-10" aria-labelledby="activity-heading">
        <h2 id="activity-heading" className="text-sm font-semibold text-zinc-800">Recent activity</h2>
        {activity.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">Your chats and generated outputs will appear here.</p>
        ) : (
          <div className="mt-3 divide-y divide-zinc-200 border-y border-zinc-200">
            {activity.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className="group flex items-center gap-3 py-3.5 hover:bg-zinc-100/60 sm:px-2"
              >
                <span className="text-zinc-400">
                  {item.kind === "Chat" ? <MessageSquare className="size-4" /> : <FileText className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-800 group-hover:text-zinc-900">{item.title}</p>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{item.meta}</p>
                </div>
                <time className="shrink-0 text-xs text-zinc-400" dateTime={item.date.toISOString()}>
                  {item.date.toLocaleDateString("en-PH", { month: "short", day: "numeric" })}
                </time>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
