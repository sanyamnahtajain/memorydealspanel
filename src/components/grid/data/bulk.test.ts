import { describe, expect, it } from "vitest";
import type { GridRow } from "@/components/grid/types";
import {
  SOFT_DELETE_FIELD,
  addTag,
  adjustCurrency,
  removeTag,
  restore,
  setField,
  setStatus,
  softDelete,
} from "./bulk";

interface Row extends GridRow {
  id: string;
  price: number; // paise
  tags: string[];
  status: string;
}

function makeRows(): Row[] {
  return [
    { id: "r1", price: 10000, tags: ["a"], status: "draft" },
    { id: "r2", price: 20000, tags: [], status: "draft" },
    { id: "r3", price: 30000, tags: ["a", "b"], status: "live" },
  ];
}

describe("setField", () => {
  it("sets a field across selected rows only", () => {
    const rows = makeRows();
    const result = setField(rows, ["r1", "r3"], "status", "archived");
    expect(result.rows[0].status).toBe("archived");
    expect(result.rows[1].status).toBe("draft"); // not selected
    expect(result.rows[2].status).toBe("archived");
    expect(result.command?.kind).toBe("bulk");
    expect(result.command?.changes).toHaveLength(2);
  });

  it("does not mutate the input rows", () => {
    const rows = makeRows();
    setField(rows, ["r1"], "status", "x");
    expect(rows[0].status).toBe("draft");
  });
});

describe("adjustCurrency — percent", () => {
  it("applies a positive percent in paise", () => {
    const rows = makeRows();
    const result = adjustCurrency(rows, ["r1", "r2", "r3"], "price", { percent: 10 });
    expect(result.rows.map((r) => r.price)).toEqual([11000, 22000, 33000]);
  });

  it("applies a negative percent and rounds to whole paise", () => {
    const rows = makeRows();
    // 10000 * 0.925 = 9250 ; 20000 * 0.925 = 18500
    const result = adjustCurrency(rows, ["r1", "r2"], "price", { percent: -7.5 });
    expect(result.rows[0].price).toBe(9250);
    expect(result.rows[1].price).toBe(18500);
    for (const r of result.rows) expect(Number.isInteger(r.price)).toBe(true);
  });
});

describe("adjustCurrency — delta", () => {
  it("applies an absolute paise delta", () => {
    const rows = makeRows();
    const result = adjustCurrency(rows, ["r1", "r2"], "price", { delta: -5000 });
    expect(result.rows[0].price).toBe(5000);
    expect(result.rows[1].price).toBe(15000);
  });
});

describe("adjustCurrency — percent + delta combined", () => {
  it("applies percent first, then delta", () => {
    const rows = makeRows();
    // r1: 10000 * 1.10 = 11000, + 500 = 11500
    const result = adjustCurrency(rows, ["r1"], "price", { percent: 10, delta: 500 });
    expect(result.rows[0].price).toBe(11500);
  });

  it("clamps negative results to the floor instead of throwing", () => {
    const rows = makeRows();
    // 10000 - 999999 would be negative -> clamp to 0
    const result = adjustCurrency(rows, ["r1"], "price", { delta: -999999 });
    expect(result.rows[0].price).toBe(0);
  });

  it("respects a custom minPaise floor", () => {
    const rows = makeRows();
    const result = adjustCurrency(rows, ["r1"], "price", {
      percent: -100,
      minPaise: 100,
    });
    expect(result.rows[0].price).toBe(100);
  });

  it("skips non-numeric cells safely", () => {
    const rows: Row[] = [
      { id: "r1", price: NaN as unknown as number, tags: [], status: "x" },
    ];
    const result = adjustCurrency(rows, ["r1"], "price", { percent: 10 });
    expect(result.command).toBeNull();
  });
});

describe("addTag / removeTag", () => {
  it("adds a tag, de-duplicating", () => {
    const rows = makeRows();
    const result = addTag(rows, ["r1", "r2", "r3"], "tags", "a");
    // r1 already has "a" -> unchanged; r2 gains it; r3 already has it.
    expect(result.rows[0].tags).toEqual(["a"]);
    expect(result.rows[1].tags).toEqual(["a"]);
    expect(result.rows[2].tags).toEqual(["a", "b"]);
    expect(result.command?.changes).toHaveLength(1); // only r2 changed
  });

  it("removes a tag where present", () => {
    const rows = makeRows();
    const result = removeTag(rows, ["r1", "r3"], "tags", "a");
    expect(result.rows[0].tags).toEqual([]);
    expect(result.rows[2].tags).toEqual(["b"]);
  });
});

describe("setStatus", () => {
  it("sets the status column", () => {
    const rows = makeRows();
    const result = setStatus(rows, ["r2"], "status", "live");
    expect(result.rows[1].status).toBe("live");
    expect(result.command?.label).toContain("live");
  });
});

describe("softDelete / restore", () => {
  it("stamps deletedAt with a deterministic timestamp", () => {
    const rows = makeRows();
    const at = "2026-07-10T00:00:00.000Z";
    const result = softDelete(rows, ["r1", "r3"], at);
    expect(result.rows[0][SOFT_DELETE_FIELD]).toBe(at);
    expect(result.rows[1][SOFT_DELETE_FIELD]).toBeUndefined();
    expect(result.rows[2][SOFT_DELETE_FIELD]).toBe(at);
  });

  it("skips already-deleted rows", () => {
    const rows = makeRows();
    const at = "2026-07-10T00:00:00.000Z";
    const once = softDelete(rows, ["r1"], at);
    const twice = softDelete(once.rows, ["r1"], "2027-01-01T00:00:00.000Z");
    expect(twice.command).toBeNull();
    expect(twice.rows[0][SOFT_DELETE_FIELD]).toBe(at);
  });

  it("restores soft-deleted rows", () => {
    const rows = makeRows();
    const at = "2026-07-10T00:00:00.000Z";
    const deleted = softDelete(rows, ["r1"], at);
    const restored = restore(deleted.rows, ["r1"]);
    expect(restored.rows[0][SOFT_DELETE_FIELD]).toBeNull();
  });
});
