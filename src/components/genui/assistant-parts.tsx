"use client";

import { getToolOrDynamicToolName, isToolOrDynamicToolUIPart, type UIMessage } from "ai";
import { ChevronDown } from "lucide-react";
import { MarkdownOutput } from "@/components/markdown-output";
import { BlockView, type BlockContext } from "@/components/genui/blocks";
import { FactCheckCard } from "@/components/genui/fact-check-card";
import { MerchantTitleBatchCard } from "@/components/genui/merchant-title-batch";
import { CmsChangeCard } from "@/components/genui/cms-change-card";
import { normalizeSpec, presentInput } from "@/lib/genui/blocks";
import { toolView } from "@/lib/genui/tool-view";

/**
 * One assistant message, drawn part by part in the order it was produced:
 * text as markdown, data tool results as cards (built from the data by code),
 * and `present` calls as the blocks the model asked for.
 */
export function AssistantParts({
  message,
  interactive,
  answeredWith,
  onReply,
}: {
  message: UIMessage;
  interactive: boolean;
  answeredWith?: string;
  onReply: (text: string) => void;
}) {
  return (
    <div className="space-y-3">
      {message.parts.map((part, i) => {
        const key = `${message.id}-${i}`;
        if (part.type === "text") {
          return part.text ? <MarkdownOutput key={key}>{part.text}</MarkdownOutput> : null;
        }
        if (part.type === "data-factcheck") {
          return (
            <FactCheckCard
              key={key}
              data={part.data as Parameters<typeof FactCheckCard>[0]["data"]}
            />
          );
        }
        if (!isToolOrDynamicToolUIPart(part)) return null;
        const name = getToolOrDynamicToolName(part);
        const ctx: BlockContext = { id: key, interactive, answeredWith, onReply };

        if (name === "present") {
          // Wait for the complete input: a half-streamed spec fails validation
          // and would flicker between partial layouts.
          if (part.state !== "input-available" && part.state !== "output-available") return null;
          const parsed = presentInput.safeParse(part.input);
          if (!parsed.success) return null;
          return (
            <div key={key} className="animate-enter space-y-3">
              {parsed.data.title && (
                <p className="text-sm font-semibold text-zinc-900">{parsed.data.title}</p>
              )}
              {parsed.data.blocks.map((b, j) => (
                <BlockView
                  key={j}
                  block={normalizeSpec(b)}
                  ctx={{ ...ctx, id: `${key}-${j}`, title: parsed.data.title }}
                />
              ))}
            </div>
          );
        }

        if (part.state !== "output-available") return null;
        if (name === "merchantProposeTitles") {
          const batchId = (part.output as { batchId?: unknown } | undefined)?.batchId;
          return typeof batchId === "string" ? <MerchantTitleBatchCard key={key} batchId={batchId} /> : null;
        }
        if (name.startsWith("cms_")) {
          const requestId = (part.output as { cmsRequestId?: unknown } | undefined)?.cmsRequestId;
          if (typeof requestId === "string") return <CmsChangeCard key={key} requestId={requestId} />;
        }
        const view = toolView(name, part.input, part.output);
        if (!view) return null;
        return (
          <details
            key={key}
            open
            className="animate-enter group rounded-xl border border-zinc-200 bg-zinc-50/60"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2.5 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">
                <span className="text-xs font-medium text-zinc-800">{view.title}</span>
                {view.subtitle && (
                  <span className="ml-2 text-xs tabular-nums text-zinc-500">{view.subtitle}</span>
                )}
              </span>
              <ChevronDown className="size-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-3 px-3.5 pb-3.5">
              {view.blocks.map((b, j) => (
                <BlockView
                  key={j}
                  block={b}
                  ctx={{
                    ...ctx,
                    id: `${name}-${j}`,
                    title: view.subtitle ? `${view.title} ${view.subtitle}` : view.title,
                  }}
                />
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}
