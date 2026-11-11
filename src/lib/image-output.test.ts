import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gifFrameSize,
  isSafeSvg,
  outputKindFromUrl,
  parseOutputSpec,
  supportsOutput,
  usesReferences,
} from "./image-output";
import { canDownloadAs, downloadFormatsFor } from "./image-download";

function dims(size: string) {
  const [w, h] = size.split("x").map(Number);
  return { w, h };
}

test("GIF and SVG run only on the 2.6 models", () => {
  assert.ok(supportsOutput("openai/gpt-image-2.6-flare", "gif"));
  assert.ok(supportsOutput("openai/gpt-image-2.6-sunburst", "svg"));
  assert.ok(!supportsOutput("openai/gpt-image-2.5-flare", "gif"));
  assert.ok(!supportsOutput("google/gemini-nano-banana-2.1", "svg"));
  assert.ok(supportsOutput("google/gemini-nano-banana-2.1", "image"));
});

test("unknown form values fall back to safe defaults", () => {
  assert.deepEqual(parseOutputSpec("nope", null, null), { kind: "image" });
  assert.deepEqual(parseOutputSpec("gif", "64", "5"), { kind: "gif", frames: 9, frameMs: 200 });
  assert.deepEqual(parseOutputSpec("gif", "16", "100"), { kind: "gif", frames: 16, frameMs: 100 });
});

test("GIF frames are 16px steps that fit the sheet OpenAI accepted", () => {
  // Measured: 16 frames at 512x512 is accepted; 9 at 1024 and 16 at 768 are not.
  const sq16 = dims(gifFrameSize("1:1", 16));
  assert.ok(sq16.w <= 512 && sq16.h <= 512);
  const sq9 = dims(gifFrameSize("1:1", 9));
  assert.ok(sq9.w * 3 * sq9.h * 3 <= 3_686_400);
  for (const ratio of ["9:16", "16:9", "4:5", "1.91:1"] as const) {
    for (const frames of [6, 9, 16]) {
      const { w, h } = dims(gifFrameSize(ratio, frames));
      assert.equal(w % 16, 0);
      assert.equal(h % 16, 0);
      assert.ok(Math.max(w, h) * 4 <= 3840, `${ratio} x${frames} edge ${w}x${h}`);
    }
  }
  // The retry shrinks.
  assert.ok(dims(gifFrameSize("1:1", 9, 0.45)).w < sq9.w);
});

test("SVGs with active content are refused", () => {
  assert.ok(isSafeSvg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>'));
  assert.ok(!isSafeSvg("<svg><script>alert(1)</script></svg>"));
  assert.ok(!isSafeSvg('<svg><rect onload="x()"/></svg>'));
  assert.ok(!isSafeSvg('<svg><a href="javascript:x()"/></svg>'));
  assert.ok(!isSafeSvg("not an svg"));
});

test("download formats follow the output kind", () => {
  const gif = "https://pub-x.r2.dev/generated/a/openai_gpt-image-2.6-flare-ig-post-v1.gif";
  const svg = "https://pub-x.r2.dev/generated/a/openai_gpt-image-2.6-flare-ig-post-v1.svg";
  const png = "https://pub-x.r2.dev/generated/a/openai_gpt-image-2.6-flare-ig-post-v1.png";
  assert.equal(outputKindFromUrl(gif), "gif");
  assert.deepEqual(downloadFormatsFor(gif).map((f) => f.id), ["gif", "webp"]);
  assert.deepEqual(downloadFormatsFor(svg).map((f) => f.id), ["svg", "png"]);
  assert.deepEqual(downloadFormatsFor(png).map((f) => f.id), ["webp", "jpg", "png"]);
  assert.ok(!canDownloadAs(png, "svg"));
  assert.ok(!canDownloadAs(gif, "jpg"));
});

test("stills and GIFs send references, SVG does not", () => {
  assert.equal(usesReferences("image"), true);
  assert.equal(usesReferences("gif"), true);
  assert.equal(usesReferences("svg"), false);
});
