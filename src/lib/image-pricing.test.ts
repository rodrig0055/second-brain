import assert from "node:assert/strict";
import { test } from "node:test";
import { IMAGE_MODEL_OPTIONS } from "./image-model-options";
import { IMAGE_MODEL_PRICING, estimateImageCost } from "./image-pricing";

test("prices text input, reference-image input and output separately", () => {
  // flare: $5 text in, $8 image in, $30 out per 1M.
  const cost = estimateImageCost(
    "openai/gpt-image-2.5-flare",
    1_500_000,
    1_000_000,
    1_000_000,
  );
  assert.equal(cost, 0.5 * 5 + 1 * 8 + 1 * 30);
});

test("without a reported split, all input prices at the image rate", () => {
  assert.equal(
    estimateImageCost("openai/gpt-image-2.5-sunburst", 1_000_000, 0),
    8,
  );
});

test("an image share larger than the input is clamped", () => {
  assert.equal(
    estimateImageCost("openai/gpt-image-2", 1_000_000, 0, 5_000_000),
    8,
  );
});

test("an unknown model overstates rather than hides the cost", () => {
  assert.equal(estimateImageCost("openai/not-a-model", 0, 1_000_000), 120);
});

test("every studio model has a published price", () => {
  for (const { id } of IMAGE_MODEL_OPTIONS) {
    assert.ok(IMAGE_MODEL_PRICING[id], `${id} has no IMAGE_MODEL_PRICING row`);
  }
});
