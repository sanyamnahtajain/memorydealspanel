import { describe, expect, it } from "vitest";
import type { ColumnDef, GridRow, SavedView } from "@/components/grid/types";
import {
  applyColumnLayout,
  applyFilters,
  applySort,
  applyView,
  createEmptyView,
  deserializeViews,
  normalizeView,
  serializeViews,
} from "./savedViews";

interface Row extends GridRow {
  id: string;
  name: string;
  price: number;
  status: string;
}

const columns: ColumnDef<Row>[] = [
  { key: "name", header: "Name", type: "text" },
  { key: "price", header: "Price", type: "currency" },
  { key: "status", header: "Status", type: "select" },
];

function rows(): Row[] {
  return [
    { id: "r1", name: "Apple", price: 300, status: "live" },
    { id: "r2", name: "Banana", price: 100, status: "draft" },
    { id: "r3", name: "Cherry", price: 200, status: "live" },
  ];
}

describe("applyFilters", () => {
  it("filters by case-insensitive substring", () => {
    const out = applyFilters(rows(), { name: "an" }, columns);
    expect(out.map((r) => r.id)).toEqual(["r2"]);
  });

  it("ANDs multiple active filters", () => {
    const out = applyFilters(rows(), { status: "live", name: "err" }, columns);
    expect(out.map((r) => r.id)).toEqual(["r3"]);
  });

  it("ignores empty queries", () => {
    const out = applyFilters(rows(), { name: "  " }, columns);
    expect(out).toHaveLength(3);
  });
});

describe("applySort", () => {
  it("sorts numbers ascending and descending", () => {
    expect(applySort(rows(), [{ colKey: "price", dir: "asc" }]).map((r) => r.price)).toEqual([100, 200, 300]);
    expect(applySort(rows(), [{ colKey: "price", dir: "desc" }]).map((r) => r.price)).toEqual([300, 200, 100]);
  });

  it("is stable for equal keys", () => {
    const out = applySort(rows(), [{ colKey: "status", dir: "asc" }]);
    // draft first, then the two live rows in original order (r1, r3).
    expect(out.map((r) => r.id)).toEqual(["r2", "r1", "r3"]);
  });

  it("does not mutate the input", () => {
    const data = rows();
    applySort(data, [{ colKey: "price", dir: "desc" }]);
    expect(data.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
  });
});

describe("applyColumnLayout", () => {
  it("reorders and hides columns", () => {
    const out = applyColumnLayout(columns, {
      columnOrder: ["status", "name"],
      hidden: ["price"],
    });
    expect(out.map((c) => c.key)).toEqual(["status", "name"]);
  });

  it("appends unknown-order columns after ordered ones", () => {
    const out = applyColumnLayout(columns, { columnOrder: ["price"], hidden: [] });
    expect(out.map((c) => c.key)).toEqual(["price", "name", "status"]);
  });
});

describe("applyView", () => {
  it("filters, sorts and lays out in one pass", () => {
    const view: SavedView = {
      id: "v1",
      name: "Live cheap-first",
      filters: { status: "live" },
      sort: [{ colKey: "price", dir: "asc" }],
      hidden: ["status"],
      columnOrder: ["price", "name"],
    };
    const out = applyView(rows(), columns, view);
    expect(out.rows.map((r) => r.id)).toEqual(["r3", "r1"]);
    expect(out.columns.map((c) => c.key)).toEqual(["price", "name"]);
  });
});

describe("normalize / serialize", () => {
  it("normalizes an untrusted object, dropping bad fields", () => {
    const v = normalizeView({
      id: "v1",
      name: "V",
      filters: { name: "x", bad: 5 },
      sort: [{ colKey: "price", dir: "asc" }, { colKey: "n", dir: "sideways" }],
      hidden: ["a", 2],
      columnOrder: ["a", "b"],
    });
    expect(v).toEqual({
      id: "v1",
      name: "V",
      filters: { name: "x" },
      sort: [{ colKey: "price", dir: "asc" }],
      hidden: ["a"],
      columnOrder: ["a", "b"],
    });
  });

  it("rejects objects without id/name", () => {
    expect(normalizeView({ name: "no id" })).toBeNull();
    expect(normalizeView(null)).toBeNull();
  });

  it("round-trips through serialize/deserialize", () => {
    const views = [createEmptyView("v1", "One"), createEmptyView("v2", "Two")];
    expect(deserializeViews(serializeViews(views))).toEqual(views);
  });

  it("deserializes garbage to an empty list", () => {
    expect(deserializeViews("{not json")).toEqual([]);
    expect(deserializeViews("{}")).toEqual([]);
  });
});
