import { describe, expect, it } from "vitest";
import type { ColumnDef, GridRow } from "@/components/grid/types";
import { applyPaste, parseTSV } from "./clipboard";

interface BenchRow extends GridRow {
  id: string;
  name: string;
  sku: string;
  price: number; // paise
  cost: number; // paise
  margin: number; // percent
  active: boolean;
  tags: string[];
  status: string;
}

// 8 editable columns mixing every coercion path (text, currency, percent,
// number, toggle, multi-tag, select) so each cell exercises validation.
const columns: ColumnDef<BenchRow>[] = [
  { key: "name", header: "Name", type: "text" },
  { key: "sku", header: "SKU", type: "text" },
  { key: "price", header: "Price", type: "currency" },
  { key: "cost", header: "Cost", type: "currency" },
  { key: "margin", header: "Margin", type: "percent" },
  { key: "active", header: "Active", type: "toggle" },
  {
    key: "tags",
    header: "Tags",
    type: "multi-tag",
    options: [
      { value: "sale", label: "Sale" },
      { value: "new", label: "New" },
      { value: "clearance", label: "Clearance" },
    ],
  },
  {
    key: "status",
    header: "Status",
    type: "select",
    options: [
      { value: "draft", label: "Draft" },
      { value: "live", label: "Live" },
      { value: "archived", label: "Archived" },
    ],
  },
];

const ROWS = 200;
const COLS = 8;

function makeRows(n: number): BenchRow[] {
  const rows: BenchRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: `r${i}`,
      name: "",
      sku: "",
      price: 0,
      cost: 0,
      margin: 0,
      active: false,
      tags: [],
      status: "draft",
    });
  }
  return rows;
}

// Build a realistic 200x8 TSV block with values that all coerce successfully
// and DIFFER from the seed so every cell produces an actual change.
function makeTSV(rowCount: number): string {
  const statuses = ["draft", "live", "archived"];
  const tagSets = ["Sale, New", "Clearance", "New", "Sale, Clearance"];
  const lines: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = [
      `Product ${r}`,
      `SKU-${1000 + r}`,
      `₹${(1200 + r).toString()}.${(r % 100).toString().padStart(2, "0")}`,
      `${800 + r}.50`,
      `${20 + (r % 40)}%`,
      r % 2 === 0 ? "true" : "false",
      tagSets[r % tagSets.length],
      statuses[r % statuses.length],
    ];
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

describe("PASTE PERF: 200-row x 8-col block", () => {
  it("parses + applies (coerce + validate every cell) under 2s", () => {
    const rows = makeRows(ROWS);
    const tsv = makeTSV(ROWS);

    const t0 = performance.now();
    const block = parseTSV(tsv);
    const parsedAt = performance.now();
    const result = applyPaste(rows, { rowId: "r0", colKey: "name" }, block, columns);
    const t1 = performance.now();

    const total = t1 - t0;
    const parseMs = parsedAt - t0;
    const applyMs = t1 - parsedAt;

    // Sanity: full rectangle coerced with no overflow and no skips. Every one
    // of the 1600 cells is coerced + validated; the recorded change count is
    // slightly lower only because cells whose coerced value equals the seed
    // (e.g. status="draft" on draft rows) are correctly deduped as no-ops.
    expect(block).toHaveLength(ROWS);
    expect(block[0]).toHaveLength(COLS);
    expect(result.overflow.extraRows).toBe(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.command?.changes.length).toBeGreaterThan(ROWS * COLS * 0.8);

    // Spot-check coercion correctness at scale.
    expect(result.rows[0].price).toBe(120000); // ₹1200.00
    expect(result.rows[0].margin).toBe(20);
    expect(result.rows[0].active).toBe(true);
    expect(result.rows[0].tags).toEqual(["sale", "new"]);
    expect(result.rows[0].status).toBe("draft");

    // eslint-disable-next-line no-console
    console.log(
      `[PASTE PERF] single run: parse=${parseMs.toFixed(2)}ms apply=${applyMs.toFixed(2)}ms total=${total.toFixed(2)}ms for ${ROWS}x${COLS}=${ROWS * COLS} cells`,
    );

    expect(total).toBeLessThan(2000);
  });

  it("sustains repeated pastes (warm avg over 20 runs) well under 2s", () => {
    const tsv = makeTSV(ROWS);
    const N = 20;
    const times: number[] = [];
    for (let k = 0; k < N; k++) {
      const rows = makeRows(ROWS);
      const t0 = performance.now();
      const block = parseTSV(tsv);
      applyPaste(rows, { rowId: "r0", colKey: "name" }, block, columns);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((s, v) => s + v, 0) / N;
    const median = times[Math.floor(N / 2)];
    const p95 = times[Math.floor(N * 0.95)];

    // eslint-disable-next-line no-console
    console.log(
      `[PASTE PERF] ${N} runs -> avg=${avg.toFixed(2)}ms median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms max=${times[N - 1].toFixed(2)}ms`,
    );

    expect(p95).toBeLessThan(2000);
    expect(avg).toBeLessThan(200);
  });
});
