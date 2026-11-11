"use client";

import {
  getToolOrDynamicToolName,
  isToolOrDynamicToolUIPart,
  type UIMessage,
} from "ai";
import { humanizeToolName } from "@/lib/tool-labels";

/**
 * Given a message's parts, returns a friendly label for the newest tool call
 * that is still running (state `input-streaming` / `input-available`), or null
 * if no tool is currently in flight. Scans from the end so the label reflects
 * the most recent activity and clears once that tool resolves or text begins.
 */
export function pickActivity(parts: UIMessage["parts"] | undefined): string | null {
  if (!parts) return null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (isToolOrDynamicToolUIPart(part)) {
      const running =
        part.state === "input-streaming" || part.state === "input-available";
      return running ? humanizeToolName(getToolOrDynamicToolName(part)) : null;
    }
  }
  return null;
}

export function ActivityLine({ label }: { label: string }) {
  return (
    <p className="u-shimmer text-sm font-medium text-zinc-600" aria-live="polite">
      {label}…
    </p>
  );
}
