import { describe, expect, it } from "vitest";
import type { EffectiveTax } from "@/lib/tax-inherit";
import { toPublicProduct, type PricedSource } from "./product";
import { toPublicVariant, type PricedVariantSource } from "./variant";

/**
 * ADVERSARIAL price-gate test (area: price-gate-leak).
 *
 * Goal: prove a GST tax AMOUNT (taxablePaise / taxPaise / cgst / sgst / igst /
 * grossPaise) can NEVER reach the PUBLIC projection — even when we hand the
 * public mappers a FULL priced Prisma row AND a resolved effective tax (the
 * exact inputs the priced path uses to compute a breakdown). The public shape
 * must carry only NON-MONETARY GST metadata (hsnCode / gstRateBps /
 * taxInclusive) and no paise anywhere in the object graph.
 */

const TAX_PAISE_KEYS = [
  "price",
  "mrp",
  "taxBreakdown",
  "taxablePaise",
  "taxPaise",
  "grossPaise",
  "cgstPaise",
  "sgstPaise",
  "igstPaise",
  "grossPaise",
];

/** Recursively assert no forbidden money key exists anywhere in the graph. */
function assertNoMoneyKeys(value: unknown, path = "$"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoMoneyKeys(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    expect(
      TAX_PAISE_KEYS.includes(k),
      `forbidden money key "${k}" found at ${path}`,
    ).toBe(false);
    assertNoMoneyKeys(v, `${path}.${k}`);
  }
}

const EFFECTIVE: EffectiveTax = {
  hsnCode: "8517",
  gstRateBps: 1800,
  treatment: "TAX_EXCLUSIVE",
};

const FULL_VARIANT_ROW: PricedVariantSource = {
  id: "0000000000000000000000d1",
  sku: "VAR-1",
  optionValues: { Capacity: "128GB" },
  stockStatus: "IN_STOCK",
  isDefault: true,
  sortOrder: 0,
  images: [],
  price: 49950,
  mrp: 59900,
};

const FULL_ROW: PricedSource = {
  id: "000000000000000000000001",
  categoryId: "0000000000000000000000c1",
  name: "Samsung EVO+ 128GB",
  slug: "samsung-evo-128gb",
  sku: "SM-EVO-128",
  brand: "Samsung",
  brandRef: { id: "0000000000000000000000b1", name: "Samsung", slug: "samsung" },
  description: null,
  specs: null,
  moq: null,
  stockStatus: "IN_STOCK",
  status: "ACTIVE",
  tags: [],
  images: [],
  createdAt: new Date("2024-01-01T00:00:00.000Z"),
  updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  price: 49950,
  mrp: 59900,
  hsnCode: "8517",
  gstRateBps: 1800,
  taxTreatment: "TAX_EXCLUSIVE",
  hasVariants: true,
  optionTypes: [{ name: "Capacity", values: ["128GB"] }],
  variants: [FULL_VARIANT_ROW],
};

describe("GST price-gate leak — Public projection carries no tax amount", () => {
  it("toPublicProduct drops all money even with a full priced row + effective tax", () => {
    const dto = toPublicProduct(FULL_ROW, { effective: EFFECTIVE });

    // Structural: no money keys anywhere in the graph (incl. nested variants).
    assertNoMoneyKeys(dto);
    expect("price" in dto).toBe(false);
    expect("mrp" in dto).toBe(false);
    expect("taxBreakdown" in dto).toBe(false);

    // The ONLY GST fields present are the non-monetary metadata.
    expect(dto.tax).toEqual({
      hsnCode: "8517",
      gstRateBps: 1800,
      taxInclusive: false,
    });
    expect("taxPaise" in dto.tax).toBe(false);
    expect("taxablePaise" in dto.tax).toBe(false);
    expect("grossPaise" in dto.tax).toBe(false);

    // Nested variant is public too.
    const [v] = dto.variants;
    expect("price" in v).toBe(false);
    expect("taxBreakdown" in v).toBe(false);
    expect(v.tax.gstRateBps).toBe(1800);
    expect("taxPaise" in v.tax).toBe(false);
  });

  it("toPublicVariant drops all money even with a full priced variant row", () => {
    const dto = toPublicVariant(FULL_VARIANT_ROW, { effective: EFFECTIVE });
    assertNoMoneyKeys(dto);
    expect("price" in dto).toBe(false);
    expect("mrp" in dto).toBe(false);
    expect("taxBreakdown" in dto).toBe(false);
    expect(dto.tax).toEqual({
      hsnCode: "8517",
      gstRateBps: 1800,
      taxInclusive: false,
    });
  });

  it("GST-off (effective=null) keeps the exact pre-GST public shape — no tax amount", () => {
    const dto = toPublicProduct(FULL_ROW, { effective: null });
    assertNoMoneyKeys(dto);
    expect(dto.tax).toEqual({
      hsnCode: null,
      gstRateBps: null,
      taxInclusive: false,
    });
  });
});
