import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  conversations,
  integrationConnections,
  messages as messagesTable,
} from "@/db/schema";
import { accessErrorResponse, apiBrand, apiTeam } from "@/lib/access";
import { detectExactMetaAdLookup } from "@/lib/integrations/meta/chat-fast-path";
import {
  formatMetaAdReport,
  getMetaAdReport,
} from "@/lib/integrations/meta/cli-report";
import {
  DEFAULT_CHAT_MODEL,
  getModelOptions,
  googleGroundingTools,
  isDeepResearchModel,
  providerOf,
  resolveModel,
} from "@/lib/models";
import { buildSystemPrompt } from "@/lib/prompt";
import { collectEvidence, factCheckAnswer, usedSkill } from "@/lib/review/fact-check";
import { buildBrainTools } from "@/lib/tools/brain-tools";
import { GENERATIVE_UI_GUIDANCE, presentTools } from "@/lib/tools/present-tool";
import { persistableParts } from "@/lib/genui/persist";
import { logUsage } from "@/lib/usage";
import { runReflection } from "@/lib/wiki/reflect";
import { hasCapability } from "@/lib/workspaces";

export const maxDuration = 300;

// Max agent steps (tool-call rounds) before we stop. On the final step we force
// `toolChoice: "none"` (see prepareStep below) so the model must emit a text
// answer instead of stopping mid-tool-loop with an empty reply.
const MAX_STEPS = 16;

function uiText(message: UIMessage | undefined): string {
  if (!message) return "";
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

function deterministicTextResponse(text: string, originalMessages: UIMessage[]) {
  const stream = createUIMessageStream({
    originalMessages,
    execute: ({ writer }) => {
      const id = crypto.randomUUID();
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: text });
      writer.write({ type: "text-end", id });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

export async function POST(req: Request) {
  // Wall-clock start, so the post-answer fact check knows how much of the
  // function's maxDuration is left.
  const startedAt = Date.now();
  try {
    const {
      messages,
      conversationId,
      model,
    }: { messages: UIMessage[]; conversationId?: string; model?: string } =
      await req.json();

    if (!conversationId) {
      return Response.json({ error: "Missing conversationId" }, { status: 400 });
    }

    const conv = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
      with: { team: true },
    });
    if (!conv) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    const { user } = await apiTeam(conv.team.slug);
    if (conv.userId !== user.id) {
      return Response.json({ error: "Not your conversation" }, { status: 403 });
    }
    // 403s if the user has since lost access to the conversation's brand.
    const { brand } = await apiBrand(conv.brandId);

    const last = messages[messages.length - 1];
    const lastText = uiText(last);
    const lastFile = last?.parts.find((p) => p.type === "file");
    if (last?.role === "user" && (lastText || lastFile)) {
      // Binary attachments (images/PDFs) aren't persisted (data URLs are large);
      // record a marker so an attachment-only turn still shows on reload. Text
      // files are already inlined into lastText by the client.
      const fileNote = lastFile
        ? `[${lastFile.mediaType?.startsWith("image/") ? "image" : "file"} attached]`
        : "";
      await db.insert(messagesTable).values({
        conversationId,
        role: "user",
        content: lastText || fileNote,
      });
    }

    // Exact single-ad metric questions have a deterministic, read-only fast
    // path. The official Meta Ads CLI fetches one ad-grain row; code validates
    // its account/ad hierarchy and calculates every displayed figure. We never
    // send this data through an LLM, and failures return no invented numbers.
    const metaLookup =
      last?.role === "user" && hasCapability(conv.team.slug, "metaExactLookup")
        ? detectExactMetaAdLookup(lastText)
        : null;
    if (metaLookup) {
      const connections = await db.query.integrationConnections.findMany({
        where: and(
          eq(integrationConnections.brandId, conv.brandId),
          eq(integrationConnections.platform, "meta"),
          eq(integrationConnections.status, "connected"),
        ),
      });

      let answer: string;
      if (connections.length === 0) {
        answer =
          "Meta Ads is not connected for this brand, so I could not retrieve live data. No figures were generated.";
      } else {
        try {
          // Brands normally have one Meta connection. When there are several,
          // query them concurrently and accept only a response whose returned
          // ad/account IDs pass the strict validator in getMetaAdReport.
          const report =
            connections.length === 1
              ? await getMetaAdReport({
                  connection: connections[0],
                  adId: metaLookup.adId,
                  dates: metaLookup.dates,
                  requestUrl: req.url,
                })
              : await Promise.any(
                  connections.map((connection) =>
                    getMetaAdReport({
                      connection,
                      adId: metaLookup.adId,
                      dates: metaLookup.dates,
                      requestUrl: req.url,
                    }),
                  ),
                );
          answer = formatMetaAdReport(report);
        } catch (error) {
          console.error("meta_cli_lookup_failed", {
            conversationId,
            brandId: conv.brandId,
            adId: metaLookup.adId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
          answer = `I could not verify live Meta data for ad \`${metaLookup.adId}\`. No figures were generated. Please retry; if this persists, check the brand's Meta connection.`;
        }
      }

      await db.insert(messagesTable).values({
        conversationId,
        role: "assistant",
        content: answer,
      });
      await db
        .update(conversations)
        .set({
          updatedAt: new Date(),
          ...(conv.title === "New chat" && lastText
            ? { title: lastText.replace(/\s+/g, " ").trim().slice(0, 80) }
            : {}),
        })
        .where(eq(conversations.id, conversationId));

      return deterministicTextResponse(answer, messages);
    }

    // Pick the chat model: a valid request override wins, else the one saved on
    // the conversation, else the global default. Validate against the known set
    // (built-in + custom) so a client can't inject an arbitrary provider string.
    const modelOptions = await getModelOptions();
    const isKnown = (m?: string | null) => !!m && modelOptions.some((o) => o.id === m);
    const chatModel = isKnown(model)
      ? model!
      : isKnown(conv.model)
        ? conv.model!
        : DEFAULT_CHAT_MODEL;

    const system =
      (await buildSystemPrompt(conv.brandId, conv.teamId)) + GENERATIVE_UI_GUIDANCE;

    // Live data tools for whatever platforms this brand has connected
    // (Shopify, …). Empty object when the brand has no connections.
    // `present` (generative UI) is chat-only: task runs don't render tool parts.
    const brainTools = {
      ...(await buildBrainTools(brand, conv.team.slug, { userId: user.id })),
      ...presentTools(),
    };
    // Gemini generateContent models additionally get Google's server-side
    // grounding tools (Search grounding + URL context). Skipped for
    // deep-research agents (own web research) and non-Google providers.
    const tools =
      providerOf(chatModel) === "google" && !isDeepResearchModel(chatModel)
        ? { ...brainTools, ...googleGroundingTools() }
        : brainTools;
    const hasTools = Object.keys(tools).length > 0;

    const modelMessages = await convertToModelMessages(messages);
    const result = streamText({
      model: await resolveModel(chatModel),
      // Cancel the upstream model call when the client disconnects / hits stop,
      // so we stop paying for tokens the user will never see.
      abortSignal: req.signal,
      // Anthropic: pass the system prompt as a leading system message so a
      // cache_control breakpoint can ride on it — that caches the whole prefix
      // before it (tool definitions + system), so repeat turns within the 5-min
      // window are served from cache instead of reprocessed at full price.
      // allowSystemInMessages silences AI SDK's injection warning (the prompt is
      // trusted, assembled server-side). Other providers keep the plain `system`
      // option and cache the prefix automatically — no breakpoint needed.
      ...(providerOf(chatModel) === "anthropic"
        ? {
            allowSystemInMessages: true,
            messages: [
              {
                role: "system" as const,
                content: system,
                providerOptions: {
                  anthropic: { cacheControl: { type: "ephemeral" } },
                },
              },
              ...modelMessages,
            ],
          }
        : { system, messages: modelMessages }),
      tools: hasTools ? tools : undefined,
      stopWhen: hasTools ? stepCountIs(MAX_STEPS) : undefined,
      // On the last allowed step, disable tools so the model is forced to write
      // its answer. Without this, a prompt that needs more tool calls than the
      // budget (e.g. "analyze these 11 competitor URLs") can end on a tool call
      // and return no text at all. toolChoice alone is not enough: deep in a
      // long tool loop Gemini can answer a tool-less step with empty text, so
      // the final step also says plainly that it must write the answer now.
      prepareStep: hasTools
        ? ({ stepNumber, messages: stepMessages }) =>
            stepNumber >= MAX_STEPS - 1
              ? {
                  toolChoice: "none",
                  messages: [
                    ...stepMessages,
                    {
                      role: "user",
                      content:
                        "Tool budget reached. Do not call any more tools. Write your complete " +
                        "answer to my request now, using only the tool results above, and say " +
                        "briefly what you could not check.",
                    },
                  ],
                }
              : {}
        : undefined,
      // totalUsage, not usage: a tool-calling chat runs up to MAX_STEPS model
      // calls, and `usage` is only the last one.
      // The assistant row itself is written by the UI stream's onFinish below,
      // which has the full message parts (tool results included).
      onFinish: async ({ text, totalUsage }) => {
        await logUsage({
          kind: "chat",
          model: chatModel,
          usage: totalUsage,
          userId: user.id,
          brandId: conv.brandId,
          teamId: conv.teamId,
          refId: conversationId,
        });
        await db
          .update(conversations)
          .set({
            updatedAt: new Date(),
            // Remember the model so it sticks across reloads.
            model: chatModel,
            // Derive a title from the first user message — once. A manually
            // renamed chat (title !== "New chat") is never overwritten.
            ...(conv.title === "New chat" && lastText
              ? { title: lastText.replace(/\s+/g, " ").trim().slice(0, 80) }
              : {}),
          })
          .where(eq(conversations.id, conversationId));

        // Wiki reflection: mine this exchange for a durable lesson. Runs last
        // so a slow/failed reflection can never delay message persistence or
        // usage logging; runReflection never throws (fully wrapped internally).
        await runReflection({
          conversationId,
          brandId: conv.brandId,
          teamId: conv.teamId,
          userId: user.id,
          messages,
          answerText: text,
        });
      },
    });

    const stream = createUIMessageStream({
      originalMessages: messages,
      execute: async ({ writer }) => {
        // The answer streams live; its finish is held back so a fact check can
        // be appended to the same message before the message closes.
        writer.merge(result.toUIMessageStream({ sendFinish: false }));
        const steps = await result.steps;
        const answer = (await result.text).trim();
        // Only answers that followed a skill: those are the long, data-heavy
        // ones where invented prices and offers showed up in testing.
        if (answer && !req.signal.aborted && usedSkill(steps)) {
          writer.write({ type: "data-factcheck", id: "factcheck", data: { status: "running", checks: [] } });
          const check = await factCheckAnswer({
            answer,
            evidence: collectEvidence(steps),
            system,
            // maxDuration is 300 s; keep 15 s for persistence and teardown.
            budgetMs: maxDuration * 1000 - (Date.now() - startedAt) - 15_000,
            usage: {
              userId: user.id,
              brandId: conv.brandId,
              teamId: conv.teamId,
              refId: conversationId,
            },
          });
          writer.write({ type: "data-factcheck", id: "factcheck", data: check });
        }
        writer.write({ type: "finish" });
      },
      onFinish: async ({ responseMessage, isAborted }) => {
        // A stopped answer was never saved before parts existed either; keep it
        // that way rather than persisting half a tool loop.
        if (isAborted) return;
        const parts = persistableParts(responseMessage.parts);
        const content = parts
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map((p) => p.text)
          .join("\n\n")
          .trim();
        // Only persist a real answer — never an empty assistant row (which would
        // pollute history and render as a blank bubble on reload).
        if (!content && parts.length === 0) return;
        await db.insert(messagesTable).values({
          conversationId,
          role: "assistant",
          content,
          parts,
        });
      },
    });
    return createUIMessageStreamResponse({ stream });
  } catch (err) {
    const res = accessErrorResponse(err);
    if (res) return res;
    console.error("chat route error", err);
    return Response.json({ error: "Chat failed" }, { status: 500 });
  }
}
