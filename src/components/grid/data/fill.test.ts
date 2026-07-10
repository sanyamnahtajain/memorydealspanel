import { describe, expect, it } from "vitest";
import type { ColumnDef, GridRow } from "@/components/grid/types";
import { fillDown, fillSeries, smartSeries } from "./fill";

interface Row extends GridRow {
  id: string;
  qty: number;
  price: number; // paise
  label: string;
}

const columns: ColumnDef<Row>[] = [
  { key: "qty", header: "Qty", type: "number" },
  { key: "price", header: "Price", type: "currency" },
  { key: "label", header: "Label", type: "text" },
];

function rows(vals: Array<Partial<Row>>): Row[] {
  return vals.map((v, i) => ({
    id: `r${i + 1}`,
    qty: 0,
    price: 0,
    label: "",
    ...v,
  }));
}

function rangeOverAll(data: Row[], colKey: string) {
  return {
    start: { rowId: data[0].id, colKey },
    end: { rowId: data[data.length - 1].id, colKey },
  };
}

describe("smartSeries", () => {
  it("continues an arithmetic series", () => {
    expect(smartSeries([100, 110], 3)).toEqual([120, 130, 140]);
  });

  it("detects a larger step", () => {
    expect(smartSeries([5, 15, 25], 2)).toEqual([35, 45]);
  });

  it("repeats when only one seed value is given", () => {
    expect(smartSeries([42], 3)).toEqual([42, 42, 42]);
  });

  it("repeats the last value when the series is not uniform", () => {
    expect(smartSeries([1, 2, 4], 2)).toEqual([4, 4]);
  });

  it("handles a decreasing series", () => {
    expect(smartSeries([100, 90], 2)).toEqual([80, 70]);
  });

  it("returns empty for a non-positive count", () => {
    expect(smartSeries([1, 2], 0)).toEqual([]);
  });
});

describe("fillDown — repeat top row (Ctrl+D)", () => {
  it("repeats a single seed value down the column", () => {
    const data = rows([{ qty: 7 }, { qty: 0 }, { qty: 0 }]);
    const result = fillDown(data, rangeOverAll(data, "qty"), columns);
    expect(result.rows.map((r) => r.qty)).toEqual([7, 7, 7]);
    expect(result.command?.kind).toBe("fill");
  });

  it("repeats the top text value downward", () => {
    const data = rows([{ label: "A" }, { label: "" }, { label: "" }]);
    const result = fillDown(data, rangeOverAll(data, "label"), columns);
    expect(result.rows.map((r) => r.label)).toEqual(["A", "A", "A"]);
  });

  it("repeats the top value even when lower rows differ", () => {
    const data = rows([{ qty: 100 }, { qty: 110 }, { qty: 55 }]);
    const result = fillDown(data, rangeOverAll(data, "qty"), columns);
    expect(result.rows.map((r) => r.qty)).toEqual([100, 100, 100]);
  });
});

describe("fillSeries — number", () => {
  it("continues a numeric series from the top two seed rows", () => {
    const data = rows([{ qty: 100 }, { qty: 110 }, { qty: 0 }, { qty: 0 }]);
    const result = fillSeries(data, rangeOverAll(data, "qty"), columns);
    expect(result.rows.map((r) => r.qty)).toEqual([100, 110, 120, 130]);
    expect(result.command?.kind).toBe("fill");
  });

  it("repeats a single seed value when no step can be established", () => {
    const data = rows([{ qty: 7 }, { qty: 0 }, { qty: 0 }]);
    // Two leading numeric cells 7,0 => step -7 is a legitimate series.
    const result = fillSeries(data, rangeOverAll(data, "qty"), columns);
    expect(result.rows.map((r) => r.qty)).toEqual([7, 0, -7]);
  });

  it("handles a decreasing series", () => {
    const data = rows([{ qty: 100 }, { qty: 90 }, { qty: 0 }, { qty: 0 }]);
    const result = fillSeries(data, rangeOverAll(data, "qty"), columns);
    expect(result.rows.map((r) => r.qty)).toEqual([100, 90, 80, 70]);
  });
});

describe("fillSeries — currency (paise)", () => {
  it("continues a currency series in integer paise", () => {
    // ₹100, ₹110 -> +₹10 => 10000, 11000, 12000, 13000 paise
    const data = rows([
      { price: 10000 },
      { price: 11000 },
      { price: 0 },
      { price: 0 },
    ]);
    const result = fillSeries(data, rangeOverAll(data, "price"), columns);
    expect(result.rows.map((r) => r.price)).toEqual([10000, 11000, 12000, 13000]);
    for (const r of result.rows) expect(Number.isInteger(r.price)).toBe(true);
  });

  it("keeps paise integer with a 50-paise step", () => {
    // 49950 (₹499.50), 50000 (₹500.00) => step 50 paise
    const data = rows([{ price: 49950 }, { price: 50000 }, { price: 0 }]);
    const result = fillSeries(data, rangeOverAll(data, "price"), columns);
    expect(result.rows.map((r) => r.price)).toEqual([49950, 50000, 50050]);
  });
});

describe("fill — guards", () => {
  it("returns the original rows for a single-row range", () => {
    const data = rows([{ qty: 5 }]);
    const range = {
      start: { rowId: "r1", colKey: "qty" },
      end: { rowId: "r1", colKey: "qty" },
    };
    expect(fillDown(data, range, columns).command).toBeNull();
    expect(fillSeries(data, range, columns).rows).toBe(data);
  });

  it("does not clone rows that are unchanged", () => {
    const data = rows([{ qty: 5 }, { qty: 5 }]);
    const result = fillDown(data, rangeOverAll(data, "qty"), columns);
    expect(result.command).toBeNull();
    expect(result.rows).toBe(data);
  });
});
