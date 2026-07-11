import { describe, it, expect } from "vitest";

import type { CategoryDTO } from "@/server/dal/categories";
import { buildProductColumns, type ProductRow } from "./productColumns";
import {
  VARIANT_MANAGED_MESSAGE,
  variantSummaryLabel,
  variantCountBadge,
  isVariantManagedField,
} from "./VariantCell";

/* -------------------------------------------------------------------------- */
/*  Fixtures                                                                  */
/* -------------------------------------------------------------------------- */

const categories: CategoryDTO[] = [
  { id: "c1", name: "Batteries" } as unknown as CategoryDTO,
];

function makeRow(overrides: Partial<ProductRow> = {}): ProductRow {
  return {
    id: "p1",
    name: "Power Bank",
    sku: "PB-1",
    brand: null,
    brandId: null,
    categoryId: "c1",
    price: 49900,
    mrp: 59900,
    stockStatus: "IN_STOCK",
    status: "ACTIVE",
    tags: [],
    images: 0,
    hasVariants: false,
    variantCount: 0,
    ...overrides,
  };
}

function columnByKey(key: string) {
  const col = buildProductColumns(categories).find((c) => c.key === key);
  if (!col) throw new Error(`missing column ${key}`);
  return col;
}

/* -------------------------------------------------------------------------- */
/*  Display helpers                                                           */
/* -------------------------------------------------------------------------- */

describe("variantSummaryLabel", () => {
  it("shows an em dash for non-variant products", () => {
    expect(variantSummaryLabel(false, 0, 49900)).toBe("—");
    // Even if stray counts/prices exist, non-variant wins.
    expect(variantSummaryLabel(false, 3, 49900)).toBe("—");
  });

  it("shows 'from ₹X · N variants' for variant products", () => {
    expect(variantSummaryLabel(true, 4, 49900)).toBe("from ₹499 · 4 variants");
  });

  it("singularises a lone variant", () => {
    expect(variantSummaryLabel(true, 1, 49900)).toBe("from ₹499 · 1 variant");
  });

  it("omits the price part when no price is available (unapproved viewer)", () => {
    expect(variantSummaryLabel(true, 2, null)).toBe("2 variants");
  });

  it("clamps a negative count to zero", () => {
    expect(variantSummaryLabel(true, -5, null)).toBe("0 variants");
  });
});

describe("variantCountBadge", () => {
  it("pluralises", () => {
    expect(variantCountBadge(0)).toBe("0 variants");
    expect(variantCountBadge(1)).toBe("1 variant");
    expect(variantCountBadge(9)).toBe("9 variants");
  });
});

describe("isVariantManagedField", () => {
  it("recognises the recompute-owned fields", () => {
    expect(isVariantManagedField("price")).toBe(true);
    expect(isVariantManagedField("mrp")).toBe(true);
    expect(isVariantManagedField("stockStatus")).toBe(true);
  });
  it("rejects product-level fields", () => {
    expect(isVariantManagedField("name")).toBe(false);
    expect(isVariantManagedField("tags")).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*  Column validators — variant guard                                        */
/* -------------------------------------------------------------------------- */

describe("price/mrp/stock validators are read-only on variant rows", () => {
  for (const key of ["price", "mrp", "stockStatus"] as const) {
    it(`${key}: blocks edits on a variant row with the managed message`, () => {
      const col = columnByKey(key);
      const variantRow = makeRow({ hasVariants: true, variantCount: 3 });
      const candidate = key === "stockStatus" ? "LOW" : 12345;
      expect(col.validate?.(candidate, variantRow)).toBe(
        VARIANT_MANAGED_MESSAGE,
      );
    });

    it(`${key}: validates normally on a non-variant row`, () => {
      const col = columnByKey(key);
      const plainRow = makeRow();
      // Use a paise value >= price so the mrp `>= price` refinement is satisfied.
      const good = key === "stockStatus" ? "LOW" : 69900;
      // A valid value passes (null) exactly as before variant-awareness.
      expect(col.validate?.(good, plainRow)).toBeNull();
    });
  }

  it("price: still rejects an invalid value on a non-variant row", () => {
    const col = columnByKey("price");
    const plainRow = makeRow();
    // Negative paise is invalid per the server schema — must still error.
    expect(col.validate?.(-100, plainRow)).not.toBeNull();
  });
});

describe("product-level columns stay editable on variant rows", () => {
  for (const key of ["name", "sku", "brandId", "categoryId", "tags"] as const) {
    it(`${key}: not force-blocked for variant products`, () => {
      const col = columnByKey(key);
      const variantRow = makeRow({ hasVariants: true, variantCount: 3 });
      // A representative valid value must NOT return the managed message.
      const value =
        key === "tags"
          ? ["x"]
          : key === "categoryId"
            ? "c1"
            : key === "brandId"
              ? ""
              : "New name";
      expect(col.validate?.(value, variantRow)).not.toBe(
        VARIANT_MANAGED_MESSAGE,
      );
    });
  }
});

describe("Variants summary column", () => {
  it("is a read-only computed column", () => {
    const col = columnByKey("variantSummary");
    expect(col.type).toBe("computed");
  });

  it("computes the summary from the row", () => {
    const col = columnByKey("variantSummary");
    const variantRow = makeRow({
      hasVariants: true,
      variantCount: 2,
      price: 49900,
    });
    expect(col.compute?.(variantRow)).toBe("from ₹499 · 2 variants");
    expect(col.compute?.(makeRow())).toBe("—");
  });
});
