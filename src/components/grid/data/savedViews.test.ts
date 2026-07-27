import { describe, expect, it } from "vitest";
import type { ColumnDef, GridRow, SavedView } from "@/components/grid/types";
import {
  applyColumnLayout,
  applyFilters,
  applySort,
  applyView,
  cellText,
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

// Display-aware column search (bugfix): per-column filter + global search must
// match the DISPLAYED cell text — option LABELS for select/multi-tag, the
// DERIVED value for computed columns, and formatted text — not the raw
// `row[key]`. These reproduce the reported "search on each column" failures.
describe("cellText / applyFilters — display-aware search", () => {
  interface R extends GridRow {
    id: string;
    name: string;
    category: string; // stored option value ("elec"); shown as a label
    tags: string[]; // multi-tag option values
    price: number; // paise; formatted as ₹
    margin: number; // stored value is intentionally WRONG; compute is the truth
  }
  const cols: ColumnDef<R>[] = [
    { key: "name", header: "Name", type: "text" },
    {
      key: "category",
      header: "Category",
      type: "select",
      options: [
        { value: "elec", label: "Electronics" },
        { value: "home", label: "Home & Kitchen" },
      ],
    },
    {
      key: "tags",
      header: "Tags",
      type: "multi-tag",
      options: [
        { value: "new", label: "New Arrival" },
        { value: "sale", label: "On Sale" },
      ],
    },
    {
      key: "price",
      header: "Price",
      type: "currency",
      format: (v) => `₹${((v as number) / 100).toFixed(2)}`,
    },
    {
      key: "margin",
      header: "Margin",
      type: "computed",
      compute: (r) => (r as R).price - 100, // derived, not the stored `margin`
    },
  ];
  const data: R[] = [
    { id: "a", name: "Cable", category: "elec", tags: ["new"], price: 500, margin: 999 },
    { id: "b", name: "Pan", category: "home", tags: ["sale", "new"], price: 300, margin: 999 },
  ];

  it("select: matches the visible LABEL as well as the stored value", () => {
    expect(applyFilters(data, { category: "Electronics" }, cols).map((r) => r.id)).toEqual(["a"]);
    expect(applyFilters(data, { category: "kitchen" }, cols).map((r) => r.id)).toEqual(["b"]);
    expect(applyFilters(data, { category: "elec" }, cols).map((r) => r.id)).toEqual(["a"]); // value still works
  });

  it("multi-tag: matches any option label in the list", () => {
    expect(applyFilters(data, { tags: "On Sale" }, cols).map((r) => r.id)).toEqual(["b"]);
    expect(applyFilters(data, { tags: "New Arrival" }, cols).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("computed: matches the DERIVED value, never the stale row[key]", () => {
    // margin = price - 100 → a:400, b:200; stored margin is 999 for both.
    expect(applyFilters(data, { margin: "400" }, cols).map((r) => r.id)).toEqual(["a"]);
    expect(applyFilters(data, { margin: "200" }, cols).map((r) => r.id)).toEqual(["b"]);
    expect(applyFilters(data, { margin: "999" }, cols)).toHaveLength(0); // proves compute, not row[key]
  });

  it("formatted: matches the formatted display text", () => {
    expect(applyFilters(data, { price: "5.00" }, cols).map((r) => r.id)).toEqual(["a"]);
    expect(applyFilters(data, { price: "₹3" }, cols).map((r) => r.id)).toEqual(["b"]);
  });

  it("cellText reproduces the on-screen text per column type", () => {
    expect(cellText(data[0], cols[1])).toContain("Electronics"); // select label
    expect(cellText(data[1], cols[2])).toContain("On Sale"); // multi-tag label
    expect(cellText(data[0], cols[3])).toBe("₹5.00"); // formatted
    expect(cellText(data[0], cols[4])).toBe("400"); // computed
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
