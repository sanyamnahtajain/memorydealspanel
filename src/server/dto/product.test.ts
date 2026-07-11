import { describe, expect, it } from "vitest";
import { computeLineTax } from "@/lib/gst";
import type { EffectiveTax } from "@/lib/tax-inherit";
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

/* ---------------------------------------------------------------------- */
/* GST threading — the price gate must NEVER leak a tax amount            */
/* ---------------------------------------------------------------------- */

const EXCLUSIVE_18: EffectiveTax = {
  hsnCode: "8523",
  gstRateBps: 1800,
  treatment: "TAX_EXCLUSIVE",
};

const INCLUSIVE_18: EffectiveTax = {
  hsnCode: "8523",
  gstRateBps: 1800,
  treatment: "TAX_INCLUSIVE",
};

describe("product DTO — GST public metadata (amount-free)", () => {
  it("public projection carries rate/HSN/inclusive metadata but NO tax paise", () => {
    const dto = toPublicProduct(BASE, { effective: EXCLUSIVE_18 });

    expect(dto.tax).toEqual({
      hsnCode: "8523",
      gstRateBps: 1800,
      taxInclusive: false,
    });

    // Adversarial: the priced-only breakdown must be STRUCTURALLY absent, and
    // no key anywhere on the public DTO (or its nested tax meta) may hold a
    // paise tax amount — even when a full priced row + a resolved tax is given.
    expect("taxBreakdown" in dto).toBe(false);
    const flat = JSON.stringify(dto);
    expect(flat).not.toContain("taxPaise");
    expect(flat).not.toContain("taxablePaise");
    expect(flat).not.toContain("grossPaise");
    // The tax meta object itself has EXACTLY the three non-monetary keys.
    expect(Object.keys(dto.tax).sort()).toEqual([
      "gstRateBps",
      "hsnCode",
      "taxInclusive",
    ]);
  });

  it("reflects an inclusive treatment on the public `taxInclusive` flag", () => {
    const dto = toPublicProduct(BASE, { effective: INCLUSIVE_18 });
    expect(dto.tax.taxInclusive).toBe(true);
  });

  it("GST off (effective null) yields the pre-GST metadata shape", () => {
    const dto = toPublicProduct(BASE);
    expect(dto.tax).toEqual({
      hsnCode: null,
      gstRateBps: null,
      taxInclusive: false,
    });
  });
});

describe("product DTO — priced tax breakdown", () => {
  it("matches computeLineTax for an EXCLUSIVE price (only place paise appear)", () => {
    const dto = toPricedProduct(BASE, { effective: EXCLUSIVE_18 });
    const expected = computeLineTax({
      amountPaise: 49950,
      gstRateBps: 1800,
      treatment: "TAX_EXCLUSIVE",
    });
    expect(dto.taxBreakdown).toEqual({
      taxablePaise: expected.taxablePaise,
      taxPaise: expected.taxPaise,
      grossPaise: expected.grossPaise,
      gstRateBps: 1800,
      treatment: "TAX_EXCLUSIVE",
    });
    // Exclusive: taxable === price; gross = taxable + tax.
    expect(dto.taxBreakdown!.taxablePaise).toBe(49950);
    expect(dto.taxBreakdown!.grossPaise).toBe(
      dto.taxBreakdown!.taxablePaise + dto.taxBreakdown!.taxPaise,
    );
  });

  it("matches computeLineTax for an INCLUSIVE price (tax is the remainder)", () => {
    const dto = toPricedProduct(BASE, { effective: INCLUSIVE_18 });
    const expected = computeLineTax({
      amountPaise: 49950,
      gstRateBps: 1800,
      treatment: "TAX_INCLUSIVE",
    });
    expect(dto.taxBreakdown).toEqual({
      taxablePaise: expected.taxablePaise,
      taxPaise: expected.taxPaise,
      grossPaise: expected.grossPaise,
      gstRateBps: 1800,
      treatment: "TAX_INCLUSIVE",
    });
    // Inclusive: gross === price; taxable + tax === gross exactly.
    expect(dto.taxBreakdown!.grossPaise).toBe(49950);
    expect(
      dto.taxBreakdown!.taxablePaise + dto.taxBreakdown!.taxPaise,
    ).toBe(49950);
  });

  it("resolves each variant's own effective tax via variantEffective", () => {
    const source: PricedSource = {
      ...BASE,
      hasVariants: true,
      variants: [
        {
          id: "00000000000000000000va01",
          sku: "V1",
          optionValues: {},
          stockStatus: "IN_STOCK",
          isDefault: true,
          sortOrder: 0,
          price: 10000,
          mrp: null,
        },
      ],
    };
    const dto = toPricedProduct(source, {
      effective: EXCLUSIVE_18,
      variantEffective: () => INCLUSIVE_18,
    });
    // The variant used the per-variant resolver (inclusive), not the product's.
    expect(dto.variants[0]!.tax.taxInclusive).toBe(true);
    expect(dto.variants[0]!.taxBreakdown!.treatment).toBe("TAX_INCLUSIVE");
    expect(dto.variants[0]!.taxBreakdown!.grossPaise).toBe(10000);
  });

  it("GST off (effective null) yields taxBreakdown null — pre-GST shape", () => {
    const dto = toPricedProduct(BASE);
    expect(dto.taxBreakdown).toBeNull();
    expect(dto.tax).toEqual({
      hsnCode: null,
      gstRateBps: null,
      taxInclusive: false,
    });
  });
});
