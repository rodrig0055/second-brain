/**
 * CSV, for taking a table out of the app.
 *
 * RFC 4180 quoting and CRLF line endings, with a UTF-8 BOM in front so Excel
 * reads it as UTF-8 rather than as the local codepage — without it a peso sign
 * or a Thai product name arrives as mojibake, which looks like our bug.
 */

export function csvEscape(cell: string): string {
  if (/[",\r\n]/.test(cell)) return `"${cell.replace(/"/g, '""')}"`;
  return cell;
}

export type CsvCell = string | number | null | undefined;

export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header.map((h) => csvEscape(String(h)))];
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscape(cell === null || cell === undefined ? "" : String(cell))));
  }
  return "﻿" + lines.map((cells) => cells.join(",")).join("\r\n");
}

export function csvFilename(base: string, today = new Date().toISOString().slice(0, 10)): string {
  const safe = base.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${safe || "export"}-${today}.csv`;
}
