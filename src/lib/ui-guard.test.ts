/**
 * Proves the Astryx ratchet in eslint.ui-guard.mjs fires on a guarded file and stays quiet on clean
 * Astryx code and on files outside ASTRYX_SURFACES. Runs in CI with the other unit tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { ESLint } from "eslint";

const cwd = path.resolve(__dirname, "../..");
const eslint = new ESLint({ cwd });
const GUARDED = path.join(cwd, "src/lib/__ui_guard_fixture__.tsx");
const UNGUARDED = path.join(cwd, "src/lib/not-migrated-fixture.tsx");

async function guardMessages(code: string, filePath = GUARDED) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.message);
}

test("raw HTML elements are rejected in a migrated file", async () => {
  const msgs = await guardMessages(`export function A() { return <div><button type="button">Go</button><table /></div>; }`);
  assert.equal(msgs.length, 3);
  assert.equal(msgs.filter((m) => m.includes("Astryx component")).length, 2);
  assert.equal(msgs.filter((m) => m.includes("raw <button>")).length, 1);
});

test("inline style on raw elements is rejected, but data-driven style on components is allowed", async () => {
  const raw = await guardMessages(`export function A() { return <span style={{ color: "red" }} />; }`);
  assert.ok(raw.some((m) => m.includes("inline style")));
  const component = await guardMessages(`import { Icon } from "x"; export function A({ c }: { c: string }) { return <Icon style={{ color: c }} />; }`);
  assert.equal(component.length, 0);
});

test("palette colours and arbitrary values in className are rejected", async () => {
  const cases = [
    `<Text className="text-zinc-500" />`,
    `<Text className="mt-2 bg-white" />`,
    `<Text className="text-[0.7rem]" />`,
    `<Text className={\`p-[13px] \${x}\`} />`,
    `<Text className={cn("hover:bg-red-50", y)} />`,
  ];
  for (const jsx of cases) {
    const msgs = await guardMessages(`import { Text } from "x"; const x = ""; const y = ""; const cn = (...a: string[]) => a.join(" "); export function A() { return ${jsx}; }`);
    assert.equal(msgs.length, 1, `expected one violation for ${jsx}, got ${JSON.stringify(msgs)}`);
  }
});

test("clean Astryx code passes", async () => {
  const msgs = await guardMessages(
    `import { VStack, Text, Button } from "x"; export function A() { return <VStack gap={4} className="text-secondary bg-surface rounded-lg p-4"><Text>Hi</Text><Button label="Go" /></VStack>; }`,
  );
  assert.deepEqual(msgs, []);
});

test("files outside ASTRYX_SURFACES are not guarded", async () => {
  const msgs = await guardMessages(`export function A() { return <div className="text-zinc-500 p-[13px]" />; }`, UNGUARDED);
  assert.deepEqual(msgs, []);
});

test("raw <button> and the retired u-press class are rejected app-wide, guarded or not", async () => {
  for (const filePath of [GUARDED, UNGUARDED]) {
    const button = await guardMessages(`export function A() { return <button type="button">Go</button>; }`, filePath);
    assert.equal(button.length, 1);
    assert.ok(button[0].includes("raw <button>"));
    const press = await guardMessages(`import Link from "next/link"; export function A() { return <Link href="/" className="u-press rounded-md">Go</Link>; }`, filePath);
    assert.equal(press.length, 1);
    assert.ok(press[0].includes("u-press"));
  }
  const fine = await guardMessages(`export function A() { return <div className="u-pressed not-u-press" />; }`, UNGUARDED);
  assert.deepEqual(fine, []);
});
