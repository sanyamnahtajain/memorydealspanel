import { describe, expect, it } from "vitest";
import {
  toPublicProduct,
  toPricedProduct,
  type PublicSource,
  type PricedSource,
} from "./product";

/**
 * Pure unit tests for the product DTO mappers. They prove two invariants at the
 * serialization boundary:
 *
 *  1. The Brand master (`brandRef`) is mapped onto BOTH the public and priced
 *     shapes — brand data is PUBLIC.
 *  2. Even when a full row carrying `price`/`mrp` is handed to `toPublicProduct`,
 *     no money key survives on the output (structural, not just `undefined`).
 */

const BASE: PricedSource = {
  id: "000000000000000000000001",
  categoryId: "0000000000000000000000c1",
  name: "Samsung EVO+ 128GB",
  slug: "samsung-evo-128gb",
  sku: "SM-EVO-128",
  brand: "Samsung",
  brandRef: {
    id: "0000000000000000000000b1",
    name: "Samsung",
    slug: "samsung",
  },
  description: null,
  specs: null,
  moq: null,
  stockStatus: "IN_STOCK",
  status: "ACTIVE",
  tags: [],
  images: [],
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-02T00:00:00.000Z"),
  price: 49950,
  mrp: 59900,
};

describe("toPublicProduct", () => {
  it("maps brandRef and omits every money key even from a full priced row", () => {
    const dto = toPublicProduct(BASE);

    expect(dto.brandRef).toEqual({
      id: "0000000000000000000000b1",
      name: "Samsung",
      slug: "samsung",
    });
    expect(dto.brand).toBe("Samsung");

    // Structural absence of money — not `undefined`, the keys don't exist.
    expect("price" in dto).toBe(false);
    expect("mrp" in dto).toBe(false);
    expect("marginPct" in dto).toBe(false);
  });

  it("maps brandRef to null when the product references no brand", () => {
    const source: PublicSource = { ...BASE, brand: null, brandRef: null };
    const dto = toPublicProduct(source);
    expect(dto.brandRef).toBeNull();
    expect(dto.brand).toBeNull();
  });

  it("treats an absent brandRef key as null", () => {
    const { brandRef: _omit, ...withoutBrandRef } = BASE;
    void _omit;
    const dto = toPublicProduct(withoutBrandRef);
    expect(dto.brandRef).toBeNull();
  });
});

describe("toPricedProduct", () => {
  it("carries brandRef alongside integer-paise price and derived margin", () => {
    const dto = toPricedProduct(BASE);
    expect(dto.brandRef).toEqual({
      id: "0000000000000000000000b1",
      name: "Samsung",
      slug: "samsung",
    });
    expect(dto.price).toBe(49950);
    expect(dto.mrp).toBe(59900);
    // (59900 - 49950) / 59900 ≈ 16.6% → rounds to 17.
    expect(dto.marginPct).toBe(17);
  });
});
