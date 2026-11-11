import { test } from "node:test";
import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import { persistableParts } from "./persist";

test("keeps text and finished tool calls, drops the rest", () => {
  const parts = [
    { type: "step-start" },
    { type: "reasoning", text: "thinking", state: "done" },
    { type: "text", text: "  ", state: "done" },
    {
      type: "tool-ga4Trend",
      toolCallId: "a",
      state: "output-available",
      input: { startDate: "2026-10-01", endDate: "2026-10-07" },
      output: { days: [] },
      callProviderMetadata: { openai: { itemId: "fc_1" } },
    },
    { type: "tool-metaSpend", toolCallId: "b", state: "input-available", input: {} },
    {
      type: "tool-google_search",
      toolCallId: "c",
      state: "output-available",
      input: {},
      output: {},
      providerExecuted: true,
    },
    { type: "text", text: "Sessions fell 12%.", state: "done", providerMetadata: { x: {} } },
  ] as unknown as UIMessage["parts"];

  const kept = persistableParts(parts);
  assert.equal(kept.length, 2);
  assert.equal(kept[0].type, "tool-ga4Trend");
  assert.equal("callProviderMetadata" in kept[0], false);
  assert.deepEqual(kept[1], { type: "text", text: "Sessions fell 12%." });
});
