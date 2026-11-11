import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCmsHost, parseRpcBody, readCallResult } from "./client";

test("hosts are reduced to an https origin", () => {
  assert.equal(normalizeCmsHost("dev3.acmeflorals.example"), "https://dev3.acmeflorals.example");
  assert.equal(normalizeCmsHost(" https://dev3.acmeflorals.example/mcp/cms "), "https://dev3.acmeflorals.example");
  assert.throws(() => normalizeCmsHost("http://dev3.acmeflorals.example"));
});

test("reads a plain JSON reply", () => {
  const msg = parseRpcBody("application/json", '{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}');
  assert.deepEqual(msg.result, { tools: [] });
});

test("reads the result out of an event stream", () => {
  const body = [
    ": keep-alive",
    'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
    'data: {"jsonrpc":"2.0","id":2,"result":{"ok":true}}',
    "",
  ].join("\n");
  assert.deepEqual(parseRpcBody("text/event-stream; charset=utf-8", body).result, { ok: true });
  assert.throws(() => parseRpcBody("text/event-stream", ": nothing\n"));
});

test("a refused call is not ok and keeps the CMS's words", () => {
  const r = readCallResult({
    content: [{ type: "text", text: "No product with that id on this storefront." }],
    isError: true,
  });
  assert.equal(r.ok, false);
  assert.equal(r.text, "No product with that id on this storefront.");
  assert.equal(r.data, undefined);
});

test("JSON text is parsed", () => {
  const r = readCallResult({ content: [{ type: "text", text: '{"id":4}' }] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { id: 4 });
});
