import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { getUserBrands, getUserTeams, requireUser } from "@/lib/access";
import { createConversation, deleteConversation } from "./actions";
import { PageHeader } from "@/components/page-header";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@astryxdesign/core/Button";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>;
}) {
  const user = await requireUser();
  const { team: requestedTeam } = await searchParams;

  const [teams, brands, chats] = await Promise.all([
    getUserTeams(user),
    getUserBrands(user),
    db.query.conversations.findMany({
      where: eq(conversations.userId, user.id),
      orderBy: [desc(conversations.updatedAt)],
      with: { brand: true, team: true },
    }),
  ]);
  const defaultTeam = teams.find((team) => team.slug === requestedTeam) ?? teams[0];

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
      <PageHeader title="Chat" />

      {teams.length === 0 || brands.length === 0 ? (
        <p className="rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
          You need access to at least one team and one brand to start a chat.
          Ask an admin to grant access.
        </p>
      ) : (
        <form
          action={createConversation}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-zinc-200 bg-white p-4"
        >
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Team
            <select
              name="teamSlug"
              required
              defaultValue={defaultTeam?.slug ?? ""}
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
            >
              {teams.map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-zinc-600">
            Brand
            <select
              name="brandId"
              required
              defaultValue={brands[0].id}
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Button label="New chat" type="submit" variant="primary" />
          <p className="basis-full text-xs text-zinc-500">
            The chat is grounded in the selected team&apos;s playbooks and the
            brand&apos;s knowledge (voice, offers, winners).
          </p>
        </form>
      )}

      <div className="mt-8 space-y-2">
        {chats.length === 0 && (
          <EmptyState
            title="No conversations yet"
            description="Choose a team and brand above to begin a grounded conversation."
          />
        )}
        {chats.map((c) => (
          <div
            key={c.id}
            className="u-transition flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-card hover:border-zinc-300 hover:bg-zinc-50"
          >
            <Link href={`/chat/${c.id}`} className="min-w-0 flex-1">
              <p className="truncate text-sm text-zinc-900">{c.title}</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {c.team.name} · {c.brand.name} ·{" "}
                {new Date(c.updatedAt).toLocaleDateString("en-PH", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </Link>
            <form action={deleteConversation}>
              <input type="hidden" name="conversationId" value={c.id} />
              <ConfirmSubmitButton
                message={`Delete “${c.title}”? This cannot be undone.`}
                label="Delete"
              />
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}
