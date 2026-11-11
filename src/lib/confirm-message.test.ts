import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMessage } from "./confirm-message";

test("first sentence becomes the title, the rest the description", () => {
  assert.deepEqual(splitMessage("Delete “Brief”? This cannot be undone."), {
    title: "Delete “Brief”?",
    description: "This cannot be undone.",
  });
  assert.deepEqual(splitMessage("Remove a@b.co? They will lose access immediately."), {
    title: "Remove a@b.co?",
    description: "They will lose access immediately.",
  });
});

test("a single sentence is all title", () => {
  assert.deepEqual(splitMessage("Remove this log entry?"), { title: "Remove this log entry?", description: "" });
  assert.deepEqual(splitMessage(`Reactivate "Ad 1" on Meta?`), { title: `Reactivate "Ad 1" on Meta?`, description: "" });
});
