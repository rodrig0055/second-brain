import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_RESPONSE_BYTES,
  ResponseTooLargeError,
  TransportError,
  asTransportError,
  mutationOutcomeUnknown,
  readBounded,
  redactError,
  redactSecrets,
} from "./http";

/** A Response whose body is a stream, the way `fetch` returns one. */
function streamed(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

test("a token in a query string never survives redaction", () => {
  // The exact shape of every read in the Meta client: the credential is in the
  // URL, so the URL is the leak.
  const url =
    "https://graph.facebook.com/v25.0/act_1/insights?access_token=EAAsecretvalue&fields=spend";
  const safe = redactSecrets(url);
  assert.ok(!safe.includes("EAAsecretvalue"));
  assert.equal(
    safe,
    "https://graph.facebook.com/v25.0/act_1/insights?access_token=[REDACTED]&fields=spend",
  );
  // The parameter name stays, so a reader can still tell a token was sent.
  assert.ok(safe.includes("access_token="));
});

test("the prefixed and nested spellings of a credential are covered too", () => {
  for (const [raw, leak] of [
    ["page_access_token=EAAsecret", "EAAsecret"],
    ["input_token=EAAsecret&access_token=EAAsecret", "EAAsecret"],
    ["appsecret_proof=abc123def", "abc123def"],
    ["client_secret=shhh", "shhh"],
    ["x_api_key=shhh", "shhh"],
    ['{"access_token":"EAAsecret","expires":123}', "EAAsecret"],
    ['{"page_access_token": "EAAsecret"}', "EAAsecret"],
    ["Authorization: Bearer EAAsecret.value", "EAAsecret"],
    ["https://user:hunter2@example.test/path", "hunter2"],
  ] as const) {
    const safe = redactSecrets(raw);
    assert.ok(!safe.includes(leak), `${raw} still leaked ${leak}`);
  }
});

test("redaction leaves the parts of an error that explain it", () => {
  const safe = redactSecrets(
    "Meta 400: (#100) Invalid parameter for field spend on act_123 " +
      "(access_token=EAAsecret)",
  );
  assert.ok(safe.includes("(#100) Invalid parameter"));
  assert.ok(safe.includes("act_123"));
  assert.ok(!safe.includes("EAAsecret"));
});

test("a network error carrying the URL is redacted by redactError", () => {
  // Node puts the request URL in the message of some fetch failures, and our
  // URLs hold the token.
  const err = new Error(
    "request to https://graph.facebook.com/v25.0/me?access_token=EAAsecret failed",
  );
  assert.ok(!redactError(err).includes("EAAsecret"));
  assert.ok(!redactError("access_token=EAAsecret").includes("EAAsecret"));
});

test("a body under the ceiling reads back whole", async () => {
  const text = await readBounded(streamed(["{\"data\":", "[1,2,3]}"]));
  assert.equal(text, '{"data":[1,2,3]}');
});

test("a body over the ceiling is refused rather than held in memory", async () => {
  // 4 chunks of 100 bytes against a 250 byte ceiling: the read stops at the
  // third, so the last chunk is never taken.
  const chunk = "x".repeat(100);
  await assert.rejects(
    () => readBounded(streamed([chunk, chunk, chunk, chunk]), 250),
    (err: unknown) => {
      assert.ok(err instanceof ResponseTooLargeError);
      assert.equal(err.limit, 250);
      return true;
    },
  );
});

test("an empty body is not an error", async () => {
  assert.equal(await readBounded(new Response(null, { status: 204 })), "");
});

test("the default ceiling is the one the client relies on", () => {
  assert.equal(MAX_RESPONSE_BYTES, 4 * 1024 * 1024);
});

test("a timeout is reported as timed out and carries no URL", () => {
  const abort = new Error("This operation was aborted");
  abort.name = "TimeoutError";
  const err = asTransportError(abort);
  assert.ok(err instanceof TransportError);
  assert.equal(err.timedOut, true);
  assert.ok(!err.message.includes("http"));
});

test("only genuinely ambiguous failures are treated as outcome-unknown", () => {
  // The rule the executor depends on: these three mean the write may have been
  // applied, so it must be verified rather than repeated.
  assert.equal(mutationOutcomeUnknown(new TransportError("gone", true)), true);
  assert.equal(mutationOutcomeUnknown(new TransportError("reset", false)), true);
  assert.equal(mutationOutcomeUnknown(new ResponseTooLargeError(10)), true);
  // A refusal Meta actually sent is not ambiguous: nothing was applied.
  assert.equal(mutationOutcomeUnknown(new Error("(#100) Invalid parameter")), false);
});
