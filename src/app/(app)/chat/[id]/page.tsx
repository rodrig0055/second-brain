import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import type { UIMessage } from "ai";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { requireUser } from "@/lib/access";
import { DEFAULT_CHAT_MODEL, getModelOptions } from "@/lib/models";
import { ChatThread } from "@/components/chat-thread";
import { EditableTitle } from "@/components/editable-title";

export default async function ChatThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const conv = await db.query.conversations.findFirst({
    where: eq(conversations.id, id),
    with: {
      brand: true,
      team: true,
      messages: { orderBy: [asc(messages.createdAt)] },
    },
  });
  if (!conv || conv.userId !== user.id) notFound();

  // Assistant rows saved with their parts redraw their charts, tables and
  // choices; older rows and user turns are plain text.
  const initialMessages: UIMessage[] = conv.messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts:
      Array.isArray(m.parts) && m.parts.length > 0
        ? (m.parts as UIMessage["parts"])
        : [{ type: "text", text: m.content }],
  }));

  const models = await getModelOptions();
  const initialModel =
    conv.model && models.some((m) => m.id === conv.model)
      ? conv.model
      : DEFAULT_CHAT_MODEL;

  // Below md the AppShell phone bar (3rem plus its 1px border) sits above the page; from md up there is none.
  return (
    <div className="flex h-[calc(100dvh-3rem-1px)] flex-col md:h-screen">
      <div className="flex min-h-16 items-center gap-3 border-b border-zinc-200 px-4 py-3 sm:px-6">
        <Link
          href="/chat"
          className="text-sm text-zinc-500 hover:text-zinc-700"
        >
          <span aria-hidden>←</span>
          <span className="sr-only">Back to conversations</span>
        </Link>
        <div className="min-w-0">
          <h1>
            <EditableTitle conversationId={conv.id} title={conv.title} />
          </h1>
          <p className="px-1 text-xs text-zinc-500">
            {conv.team.name} · {conv.brand.name}
          </p>
        </div>
      </div>
      <ChatThread
        conversationId={conv.id}
        initialMessages={initialMessages}
        models={models}
        initialModel={initialModel}
      />
    </div>
  );
}
