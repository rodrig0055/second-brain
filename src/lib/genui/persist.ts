import { isToolOrDynamicToolUIPart, type UIMessage } from "ai";

type Part = UIMessage["parts"][number];

/**
 * The parts of an assistant message worth saving so a reloaded chat redraws
 * what the user saw: text, plus every finished tool call (its result is what
 * the charts and tables are drawn from, and what the model re-reads as
 * history on the next turn).
 *
 * Dropped:
 *   - reasoning, step markers, sources: not shown in the thread.
 *   - unfinished tool calls: nothing to draw, and a call without a result is
 *     invalid history for every provider.
 *   - provider-executed tools (Gemini search grounding): replayed into another
 *     provider after a model switch they are a call to a tool it doesn't have.
 *   - provider metadata: ties a part to one provider's server state (OpenAI
 *     item ids), which breaks the replay after a model switch.
 */
export function persistableParts(parts: UIMessage["parts"]): Part[] {
  const out: Part[] = [];
  for (const part of parts) {
    if (part.type === "text") {
      if (part.text.trim()) out.push({ type: "text", text: part.text });
      continue;
    }
    // The post-answer fact check (see api/chat): kept so a reloaded chat still
    // shows which claims were checked. Never replayed to the model.
    if (part.type === "data-factcheck") {
      out.push(part);
      continue;
    }
    if (!isToolOrDynamicToolUIPart(part)) continue;
    if (part.providerExecuted) continue;
    if (part.state !== "output-available" && part.state !== "output-error") continue;
    const rest: Record<string, unknown> = { ...part };
    delete rest.callProviderMetadata;
    delete rest.resultProviderMetadata;
    out.push(rest as Part);
  }
  return out;
}
