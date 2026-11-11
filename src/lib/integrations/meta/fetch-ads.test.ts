import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { fetchAdsByIds } from "./client";

const target = { accountId: "act_1", apiVersion: "v26.0", accessToken: "t" };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A Graph Batch API where `deleted` ids answer 400 inside the batch. */
function fakeBatch(deleted: Set<string>, whole?: { status: number; body: unknown }) {
  const calls: { url: string; ids: string[] }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body));
    const batch = JSON.parse(form.get("batch") ?? "[]") as { relative_url: string }[];
    const ids = batch.map((b) => b.relative_url.split("?")[0]);
    calls.push({ url: String(url), ids });
    if (whole) return new Response(JSON.stringify(whole.body), { status: whole.status });
    const replies = ids.map((id) =>
      deleted.has(id)
        ? { code: 400, body: JSON.stringify({ error: { message: "does not exist", code: 100 } }) }
        : { code: 200, body: JSON.stringify({ id, name: `ad ${id}` }) },
    );
    return new Response(JSON.stringify(replies), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test("uses one batch POST per 50 ids, never the removed ?ids= form", async () => {
  const ids = Array.from({ length: 120 }, (_, i) => String(i + 1));
  const calls = fakeBatch(new Set());
  const got = await fetchAdsByIds(target, ids);
  assert.equal(got.length, 120);
  assert.deepEqual(calls.map((c) => c.ids.length), [50, 50, 20]);
  assert.ok(calls.every((c) => !c.url.includes("ids=")));
});

test("a deleted ad fails alone and the rest of its batch comes back", async () => {
  const ids = Array.from({ length: 50 }, (_, i) => String(i + 1));
  fakeBatch(new Set(["17"]));
  const got = await fetchAdsByIds(target, ids);
  assert.equal(got.length, 49);
  assert.ok(!got.some((c) => c.adId === "17"));
});

test("a failure of the whole batch is thrown, not swallowed", async () => {
  fakeBatch(new Set(), { status: 400, body: { error: { message: "token expired", code: 190 } } });
  await assert.rejects(fetchAdsByIds(target, ["1", "2"]), /token expired/);
});
