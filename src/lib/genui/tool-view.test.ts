import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSpec, parseNumeric, presentInput, type Block } from "./blocks";
import { humanizeKey, toolView } from "./tool-view";

const byType = <T extends Block["type"]>(blocks: Block[], type: T) =>
  blocks.filter((b): b is Extract<Block, { type: T }> => b.type === type);

test("parseNumeric reads money, counts and percentages, nothing else", () => {
  assert.equal(parseNumeric("₱12,400.50"), 12400.5);
  assert.equal(parseNumeric("PHP 1,234"), 1234);
  assert.equal(parseNumeric("-3.5"), -3.5);
  assert.equal(parseNumeric("12.3%"), 12.3);
  assert.equal(parseNumeric("/p5"), null);
  assert.equal(parseNumeric("2026-10-12"), null);
  assert.equal(parseNumeric("Roses 12"), null);
  assert.equal(parseNumeric(""), null);
  assert.equal(parseNumeric("%"), null);
});

test("humanizeKey splits camelCase and upper-cases acronyms", () => {
  assert.equal(humanizeKey("purchaseRevenue"), "Purchase revenue");
  assert.equal(humanizeKey("cpa"), "CPA");
  assert.equal(humanizeKey("firstHalfCtr"), "First half CTR");
});

test("account totals become KPI tiles with money detected", () => {
  const view = toolView(
    "googleAdsSpend",
    { startDate: "2026-10-01", endDate: "2026-10-07" },
    {
      currency: "PHP",
      days: 7,
      spend: "1200.00",
      revenue: "4800.00",
      roas: "4.00",
      clicks: 300,
      conversions: 12,
      cpa: "100.00",
      ctr: "2.10%",
    },
  );
  assert.ok(view);
  assert.equal(view.title, "Google Ads spend");
  assert.equal(view.subtitle, "2026-10-01 to 2026-10-07");
  const [kpis] = byType(view.blocks, "kpis");
  const labels = kpis.items.map((k) => k.label);
  assert.ok(!labels.includes("Days"), "row counts are metadata, not KPIs");
  assert.ok(!labels.includes("Currency"));
  const spend = kpis.items.find((k) => k.label === "Spend");
  assert.deepEqual(spend, { label: "Spend", value: 1200, format: "money" });
  // Ratios and percentages keep the tool's own formatting.
  assert.equal(kpis.items.find((k) => k.label === "ROAS")?.value, "4.00");
  assert.equal(kpis.items.find((k) => k.label === "CTR")?.value, "2.10%");
});

test("a daily series becomes a chart plus a table, sorted by date", () => {
  const view = toolView(
    "ga4Trend",
    { startDate: "2026-10-01", endDate: "2026-10-03" },
    {
      currency: "PHP",
      days: [
        { date: "2026-10-02", sessions: 120, transactions: 3, revenue: "900.00" },
        { date: "2026-10-01", sessions: 100, transactions: 2, revenue: "600.00" },
        { date: "2026-10-03", sessions: 90, transactions: 1, revenue: "300.00" },
      ],
    },
  );
  assert.ok(view);
  const [chart] = byType(view.blocks, "chart");
  assert.deepEqual(chart.labels, ["2026-10-01", "2026-10-02", "2026-10-03"]);
  assert.deepEqual(chart.series.map((s) => s.name), ["Sessions", "Transactions", "Revenue"]);
  assert.deepEqual(chart.series[2].values, [600, 900, 300]);
  assert.equal(chart.series[2].format, "money");
  const [table] = byType(view.blocks, "table");
  assert.equal(table.rows.length, 3);
});

test("the longest list wins, so a filtered subset is not drawn twice", () => {
  const campaigns = [
    { campaignId: "1", campaignName: "A", spend: "10.00", conversions: 0, wastedSpend: true },
    { campaignId: "2", campaignName: "B", spend: "20.00", conversions: 3, wastedSpend: false },
  ];
  const view = toolView(
    "metaCampaignPerformance",
    {},
    { currency: "PHP", campaignCount: 2, wastedSpendCampaigns: [campaigns[0]], campaigns },
  );
  assert.ok(view);
  const tables = byType(view.blocks, "table");
  assert.equal(tables.length, 1);
  assert.equal(tables[0].rows.length, 2);
  const id = tables[0].columns.find((c) => c.key === "campaignId");
  assert.equal(id?.hidden, true, "ids are hidden by default");
  assert.equal(id?.numeric, false, "ids are labels, not numbers");
  assert.equal(tables[0].rows[0].campaignId, "1");
  const [kpis] = byType(view.blocks, "kpis");
  assert.equal(kpis, undefined, "a row count above its own table is noise");
  assert.equal(tables[0].rows[0].wastedSpend, "Yes");
  assert.equal(tables[0].columns.find((c) => c.key === "spend")?.format, "money");
  assert.equal(byType(view.blocks, "chart").length, 0, "no dates, no chart");
});

test("errors render as a warning, prose tools render nothing", () => {
  const err = toolView("metaSpend", {}, { error: "token expired" });
  assert.deepEqual(err?.blocks, [
    { type: "callout", tone: "warn", text: "Could not load: token expired" },
  ]);
  assert.equal(toolView("fetchWebPage", {}, { text: "hello" }), null);
  assert.equal(toolView("unknownTool", {}, { note: "just words" }), null);
  assert.equal(toolView("unknownTool", {}, "a string"), null);
});

test("present specs validate and normalize", () => {
  const parsed = presentInput.parse({
    blocks: [
      { type: "table", columns: ["Hub", "Orders"], rows: [["Makati", "1,204"], ["BGC"]] },
      { type: "chart", kind: "bar", labels: ["a", "b", "c"], series: [{ name: "x", values: [1, 2] }] },
      { type: "choices", options: [{ label: "One" }, { label: "Two", reply: "Go with two" }] },
    ],
  });
  const [table, chart] = parsed.blocks.map(normalizeSpec);
  assert.equal(table.type, "table");
  if (table.type === "table") {
    assert.equal(table.columns[1].numeric, true);
    assert.equal(table.columns[0].numeric, false);
    assert.equal(table.rows[1].c1, null, "ragged rows are padded");
  }
  assert.equal(chart.type, "chart");
  if (chart.type === "chart") assert.deepEqual(chart.labels, ["a", "b"]);

  assert.throws(() => presentInput.parse({ blocks: [{ type: "choices", options: [{ label: "only" }] }] }));
});
