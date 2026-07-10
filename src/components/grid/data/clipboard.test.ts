import { describe, expect, it } from "vitest";
import type { ColumnDef, GridRow } from "@/components/grid/types";
import {
  applyPaste,
  parseTSV,
  serializeSelectionToTSV,
} from "./clipboard";

interface Row extends GridRow {
  id: string;
  name: string;
  price: number; // paise
  active: boolean;
  tags: string[];
  status: string;
}

const columns: ColumnDef<Row>[] = [
  { key: "name", header: "Name", type: "text" },
  { key: "price", header: "Price", type: "currency" },
  { key: "active", header: "Active", type: "toggle" },
  {
    key: "tags",
    header: "Tags",
    type: "multi-tag",
    options: [
      { value: "sale", label: "Sale" },
      { value: "new", label: "New" },
    ],
  },
  {
    key: "status",
    header: "Status",
    type: "select",
    options: [
      { value: "draft", label: "Draft" },
      { value: "live", label: "Live" },
    ],
  },
];

function makeRows(): Row[] {
  return [
    { id: "r1", name: "Widget", price: 49950, active: true, tags: ["sale"], status: "live" },
    { id: "r2", name: "Gadget", price: 10000, active: false, tags: [], status: "draft" },
    { id: "r3", name: "Gizmo", price: 250000, active: true, tags: ["new"], status: "live" },
  ];
}

describe("parseTSV", () => {
  it("parses a simple grid", () => {
    expect(parseTSV("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("drops a single trailing newline", () => {
    expect(parseTSV("a\tb\n")).toEqual([["a", "b"]]);
  });

  it("normalizes CRLF line endings", () => {
    expect(parseTSV("a\tb\r\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles quoted cells with embedded tabs and newlines", () => {
    const tsv = '"has\ttab"\tplain\n"line\nbreak"\tx';
    expect(parseTSV(tsv)).toEqual([
      ["has\ttab", "plain"],
      ["line\nbreak", "x"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseTSV('"she said ""hi"""')).toEqual([['she said "hi"']]);
  });
});

describe("serializeSelectionToTSV", () => {
  it("serializes a rectangular selection with currency as bare rupees", () => {
    const rows = makeRows();
    const tsv = serializeSelectionToTSV(
      rows,
      { start: { rowId: "r1", colKey: "name" }, end: { rowId: "r2", colKey: "price" } },
      columns,
    );
    expect(tsv).toBe("Widget\t499.50\nGadget\t100");
  });

  it("handles unordered range endpoints", () => {
    const rows = makeRows();
    const tsv = serializeSelectionToTSV(
      rows,
      { start: { rowId: "r2", colKey: "price" }, end: { rowId: "r1", colKey: "name" } },
      columns,
    );
    expect(tsv).toBe("Widget\t499.50\nGadget\t100");
  });

  it("quotes cells containing tabs", () => {
    const rows: Row[] = [
      { id: "r1", name: "a\tb", price: 0, active: false, tags: [], status: "draft" },
    ];
    const tsv = serializeSelectionToTSV(
      rows,
      { start: { rowId: "r1", colKey: "name" }, end: { rowId: "r1", colKey: "name" } },
      columns,
    );
    expect(tsv).toBe('"a\tb"');
  });
});

describe("round-trip: serialize -> parse -> paste preserves currency paise", () => {
  it("survives currency through the full cycle", () => {
    const rows = makeRows();
    const range = {
      start: { rowId: "r1", colKey: "price" },
      end: { rowId: "r3", colKey: "price" },
    };
    const tsv = serializeSelectionToTSV(rows, range, columns);
    const block = parseTSV(tsv);
    // Paste the copied prices onto a fresh set of rows (same target column).
    const fresh = makeRows().map((r) => ({ ...r, price: 0 }));
    const result = applyPaste(fresh, { rowId: "r1", colKey: "price" }, block, columns);
    expect(result.rows.map((r) => r.price)).toEqual([49950, 10000, 250000]);
  });
});

describe("applyPaste", () => {
  it("coerces rupee text to integer paise", () => {
    const rows = makeRows();
    const result = applyPaste(
      rows,
      { rowId: "r1", colKey: "price" },
      [["₹1,299.50"]],
      columns,
    );
    expect(result.rows[0].price).toBe(129950);
    expect(result.command?.kind).toBe("paste-block");
    expect(result.command?.changes[0]).toMatchObject({
      coord: { rowId: "r1", colKey: "price" },
      prev: 49950,
      next: 129950,
    });
  });

  it("maps a multi-column block by position from the target", () => {
    const rows = makeRows();
    const block = [
      ["New Name", "500", "true"],
      ["Other", "1000", "false"],
    ];
    const result = applyPaste(rows, { rowId: "r1", colKey: "name" }, block, columns);
    expect(result.rows[0]).toMatchObject({ name: "New Name", price: 50000, active: true });
    expect(result.rows[1]).toMatchObject({ name: "Other", price: 100000, active: false });
  });

  it("reports overflow rows without writing them", () => {
    const rows = makeRows(); // 3 rows
    const block = [["a"], ["b"], ["c"], ["d"], ["e"]]; // 5 rows tall
    const result = applyPaste(rows, { rowId: "r2", colKey: "name" }, block, columns);
    // Targets r2 (idx1), r3 (idx2) = 2 written; 3 overflow.
    expect(result.overflow.extraRows).toBe(3);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[1].name).toBe("a");
    expect(result.rows[2].name).toBe("b");
  });

  it("skips cells that fail coercion and records them", () => {
    const rows = makeRows();
    const result = applyPaste(
      rows,
      { rowId: "r1", colKey: "price" },
      [["not-money"]],
      columns,
    );
    expect(result.command).toBeNull();
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].coord).toEqual({ rowId: "r1", colKey: "price" });
    expect(result.rows[0].price).toBe(49950); // unchanged
  });

  it("clips columns past the right edge instead of throwing", () => {
    const rows = makeRows(); // r2.status starts as "draft"
    const block = [["live", "EXTRA", "MORE"]];
    const result = applyPaste(rows, { rowId: "r2", colKey: "status" }, block, columns);
    // Starts at the last column (status); only that one column is written and
    // the extra block columns are clipped rather than throwing.
    expect(result.rows[1].status).toBe("live");
    expect(result.command?.changes).toHaveLength(1);
    expect(result.overflow.extraRows).toBe(0);
  });

  it("coerces multi-tag from comma-separated labels", () => {
    const rows = makeRows();
    const result = applyPaste(
      rows,
      { rowId: "r2", colKey: "tags" },
      [["Sale, New"]],
      columns,
    );
    expect(result.rows[1].tags).toEqual(["sale", "new"]);
  });

  it("returns the original rows array when nothing changes", () => {
    const rows = makeRows();
    const result = applyPaste(
      rows,
      { rowId: "r1", colKey: "name" },
      [["Widget"]],
      columns,
    );
    expect(result.command).toBeNull();
    expect(result.rows).toBe(rows);
  });
});
