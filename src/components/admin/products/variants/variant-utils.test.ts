import { describe, expect, it } from "vitest";
import {
  cartesian,
  ensureSingleDefault,
  fromPrice,
  reconcileVariants,
  setDefault,
  suggestSku,
  variantKey,
  variantLabel,
} from "./variant-utils";
import type { EditorVariant, OptionType } from "./types";

/**
 * Invariants of the variants editor's pure core. These matter because the
 * generated matrix and the derived "from" price are what keep variant products
 * backward-compatible: listing/sort read Product.price, which MUST equal the
 * cheapest ACTIVE variant.
 */

const AXES: OptionType[] = [
  { name: "Capacity", values: ["10000mAh", "20000mAh"] },
  { name: "Color", values: ["Black", "White"] },
];

function makeVariant(over: Partial<EditorVariant>): EditorVariant {
  return {
    id: null,
    key: "k",
    optionValues: {},
    sku: "SKU",
    price: 10000,
    mrp: null,
    moq: null,
    stockStatus: "IN_STOCK",
    status: "ACTIVE",
    isDefault: false,
    sortOrder: 0,
    imageCount: 0,
    ...over,
  };
}

describe("cartesian", () => {
  it("is the exact cartesian product of the axes, in declared order", () => {
    const combos = cartesian(AXES);
    expect(combos).toHaveLength(4);
    expect(combos).toEqual([
      { Capacity: "10000mAh", Color: "Black" },
      { Capacity: "10000mAh", Color: "White" },
      { Capacity: "20000mAh", Color: "Black" },
      { Capacity: "20000mAh", Color: "White" },
    ]);
  });

  it("skips blank axes and de-dupes values case-insensitively", () => {
    const combos = cartesian([
      { name: "Size", values: ["S", "s", " M "] },
      { name: "  ", values: ["ignored"] },
      { name: "Empty", values: [] },
    ]);
    expect(combos).toEqual([{ Size: "S" }, { Size: "M" }]);
  });

  it("returns no combinations when there is no usable axis", () => {
    expect(cartesian([])).toEqual([]);
    expect(cartesian([{ name: "X", values: [] }])).toEqual([]);
  });
});

describe("suggestSku", () => {
  it("joins a tokenized base and option values", () => {
    expect(
      suggestSku("PB-ANK", { Capacity: "20000mAh", Color: "Black" }),
    ).toBe("PB-ANK-20000MAH-BLACK");
  });

  it("falls back to a base when the parent sku is empty", () => {
    expect(suggestSku("", { Color: "Red" })).toBe("SKU-RED");
  });
});

describe("fromPrice", () => {
  it("is the minimum price across ACTIVE variants only", () => {
    const rows = [
      makeVariant({ price: 50000, status: "ACTIVE" }),
      makeVariant({ price: 30000, status: "INACTIVE" }), // cheaper but inactive
      makeVariant({ price: 40000, status: "ACTIVE" }),
    ];
    expect(fromPrice(rows)).toBe(40000);
  });

  it("ignores zero / non-positive prices and returns null when none qualify", () => {
    expect(fromPrice([makeVariant({ price: 0, status: "ACTIVE" })])).toBeNull();
    expect(
      fromPrice([makeVariant({ price: 99900, status: "INACTIVE" })]),
    ).toBeNull();
    expect(fromPrice([])).toBeNull();
  });
});

describe("reconcileVariants", () => {
  it("preserves edits on surviving combinations and seeds new ones", () => {
    const existing = [
      makeVariant({
        key: variantKey({ Capacity: "10000mAh", Color: "Black" }),
        optionValues: { Capacity: "10000mAh", Color: "Black" },
        price: 12345,
        sku: "CUSTOM-SKU",
        isDefault: true,
      }),
    ];
    const rows = reconcileVariants(AXES, existing, "PB", {
      price: 20000,
      mrp: 25000,
    });

    expect(rows).toHaveLength(4);
    const survived = rows.find((r) => r.sku === "CUSTOM-SKU");
    expect(survived?.price).toBe(12345); // edit preserved
    expect(survived?.isDefault).toBe(true); // default carried over

    const fresh = rows.find(
      (r) => r.key === variantKey({ Capacity: "20000mAh", Color: "White" }),
    );
    expect(fresh?.price).toBe(20000); // seeded from base price
    expect(fresh?.mrp).toBe(25000);
    expect(fresh?.sku).toBe("PB-20000MAH-WHITE"); // auto-suggested
  });

  it("drops combinations whose axis value was removed", () => {
    const existing = reconcileVariants(AXES, [], "PB", {
      price: 10000,
      mrp: null,
    });
    const shrunk = reconcileVariants(
      [{ name: "Capacity", values: ["10000mAh", "20000mAh"] }],
      existing,
      "PB",
      { price: 10000, mrp: null },
    );
    expect(shrunk).toHaveLength(2);
    expect(shrunk.every((r) => !("Color" in r.optionValues))).toBe(true);
  });
});

describe("ensureSingleDefault / setDefault", () => {
  it("always yields exactly one default", () => {
    const rows = ensureSingleDefault([
      makeVariant({ key: "a" }),
      makeVariant({ key: "b" }),
      makeVariant({ key: "c" }),
    ]);
    expect(rows.filter((r) => r.isDefault)).toHaveLength(1);
    expect(rows[0].isDefault).toBe(true);
  });

  it("moves the default and clears it elsewhere", () => {
    const rows = setDefault(
      [makeVariant({ key: "a", isDefault: true }), makeVariant({ key: "b" })],
      "b",
    );
    expect(rows.find((r) => r.key === "b")?.isDefault).toBe(true);
    expect(rows.find((r) => r.key === "a")?.isDefault).toBe(false);
  });
});

describe("variantLabel", () => {
  it("joins values with a middot", () => {
    expect(variantLabel({ Capacity: "20000mAh", Color: "Black" })).toBe(
      "20000mAh · Black",
    );
    expect(variantLabel({})).toBe("Default");
  });
});
