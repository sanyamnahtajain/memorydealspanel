import { describe, expect, it } from "vitest";

import { toProductRow, toUpdateInput } from "./adapters";
import type { ProductRow } from "./productColumns";
import type { AdminGridProduct } from "@/server/dal/products";

/**
 * MOQ in the bulk grid. The column exists so an operator can fill a minimum
 * order quantity down a whole column at once, which is the point of the grid.
 */
describe("MOQ ↔ grid row", () => {
  const product = (moq: number | null) =>
    ({
      id: "p1",
      name: "Power Bank",
      sku: "PB-1",
      brand: null,
      brandRef: null,
      categoryId: "c1",
      price: 100,
      mrp: null,
      moq,
      stockStatus: "IN_STOCK",
      status: "ACTIVE",
      tags: [],
      imageCount: 0,
      hasVariants: false,
      variantCount: 0,
      hsnCode: null,
      gstRateBps: null,
      updatedAt: new Date("2026-09-14T00:00:00Z"),
    }) as unknown as AdminGridProduct;

  it("carries a product's MOQ into its row, and null when unset", () => {
    expect(toProductRow(product(24)).moq).toBe(24);
    expect(toProductRow(product(null)).moq).toBeNull();
  });
});

describe("MOQ ↔ server patch", () => {
  it("sends an edited MOQ", () => {
    expect(toUpdateInput({ moq: 50 } as Partial<ProductRow>)?.moq).toBe(50);
  });

  it("an emptied cell clears the minimum rather than sending null", () => {
    // The server schema treats MOQ as optional; undefined is "no minimum".
    expect(
      toUpdateInput({ moq: null } as Partial<ProductRow>)?.moq,
    ).toBeUndefined();
  });

  it("leaves MOQ alone when the patch doesn't mention it", () => {
    // The trap this guards: a bulk edit of one column silently rewriting
    // another. Absent must stay absent.
    const patch = toUpdateInput({ price: 100 } as Partial<ProductRow>);
    expect(patch && "moq" in patch).toBe(false);
  });
});
