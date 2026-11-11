import { test } from "node:test";
import assert from "node:assert/strict";
import { csvEscape, csvFilename, toCsv } from "./csv";

const BOM = "﻿";

test("csvEscape only quotes what needs it", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape("has, comma"), '"has, comma"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape("line\nbreak"), '"line\nbreak"');
  assert.equal(csvEscape(""), "");
});

test("toCsv writes a BOM and CRLF rows", () => {
  const csv = toCsv(["a", "b"], [["1", "2"]]);
  assert.equal(csv.startsWith(BOM), true);
  assert.equal(csv, `${BOM}a,b\r\n1,2`);
});

test("toCsv renders null and undefined as empty, not as the words", () => {
  const csv = toCsv(["a", "b", "c"], [[null, undefined, 0]]);
  assert.equal(csv, `${BOM}a,b,c\r\n,,0`);
});

test("toCsv survives a caption with commas, quotes and newlines", () => {
  const csv = toCsv(["caption"], [['Roses, "fresh"\nsame day']]);
  assert.equal(csv, `${BOM}caption\r\n"Roses, ""fresh""\nsame day"`);
});

test("csvFilename is safe and dated", () => {
  assert.equal(csvFilename("Bloomly PH ads", "2026-09-17"), "bloomly-ph-ads-2026-09-17.csv");
  assert.equal(csvFilename("!!!", "2026-09-17"), "export-2026-09-17.csv");
});
