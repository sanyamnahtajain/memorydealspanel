import { describe, expect, it } from "vitest";
import { computeLineTax } from "@/lib/gst";
import type { EffectiveTax } from "@/lib/tax-inherit";
import {
  toPublicVariant,
  toPricedVariant,
  type PublicVariantSource,
  type PricedVariantSource,
} from "./variant";

/**
 * Pure unit tests for the ProductVariant DTO mappers. They prove the variant
 * half of the price gate at the serialization boundary:
 *
 *  1. Even when a full row carrying `price`/`mrp` is handed to
 *     `toPublicVariant`, NO money key survives on the output (structural
 *     absence, not just `undefined`).
 *  2. `toPricedVariant` layers integer-paise money + a derived whole-number
 *     margin onto the same public projection.
 *  3. `optionValues` is coerced to a clean string→string map.
 */

const BASE: PricedVariantSource = {
  id: "00000000000000000000v001",
  sku: "PB-20K-BLK",
  optionValues: { Capacity: "20000mAh", Color: "Black" },
  stockStatus: "IN_STOCK",
  isDefault: true,
  sortOrder: 0,
  images: [],
  price: 149900,
  mrp: 199900,
};

describe("toPublicVariant", () => {
  it("omits every money key even from a full priced row", () => {
    const dto = toPublicVariant(BASE);

    expect(dto.sku).toBe("PB-20K-BLK");
    expect(dto.optionValues).toEqual({ Capacity: "20000mAh", Color: "Black" });
    expect(dto.stockStatus).toBe("IN_STOCK");
    expect(dto.isDefault).toBe(true);

    // Structural absence of money — not `undefined`, the keys don't exist.
    expect("price" in dto).toBe(false);
    expect("mrp" in dto).toBe(false);
    expect("marginPct" in dto).toBe(false);
  });

  it("coerces a malformed optionValues JSON to a clean string map", () => {
    const source: PublicVariantSource = {
      ...BASE,
      // Non-string values and array/null must be dropped, not crash.
      optionValues: { Capacity: "10000mAh", Qty: 5, Bad: null } as never,
    };
    const dto = toPublicVariant(source);
    expect(dto.optionValues).toEqual({ Capacity: "10000mAh" });
  });

  it("yields an empty optionValues map for null/array JSON", () => {
    expect(toPublicVariant({ ...BASE, optionValues: null }).optionValues).toEqual(
      {},
    );
    expect(
      toPublicVariant({ ...BASE, optionValues: [] as never }).optionValues,
    ).toEqual({});
  });
});

describe("toPricedVariant", () => {
  it("carries integer-paise price + derived whole-number margin", () => {
    const dto = toPricedVariant(BASE);
    expect(dto.price).toBe(149900);
    expect(dto.mrp).toBe(199900);
    // (199900 - 149900) / 199900 ≈ 25.01% → rounds to 25.
    expect(dto.marginPct).toBe(25);
    // Public fields are still present alongside money.
    expect(dto.optionValues).toEqual({ Capacity: "20000mAh", Color: "Black" });
  });

  it("returns null margin when mrp is absent or not above price", () => {
    expect(toPricedVariant({ ...BASE, mrp: null }).marginPct).toBeNull();
    expect(toPricedVariant({ ...BASE, mrp: 149900 }).marginPct).toBeNull();
  });
});

/* ---------------------------------------------------------------------- */
/* GST threading — the variant gate must NEVER leak a tax amount          */
/* ---------------------------------------------------------------------- */

const EXCLUSIVE_18: EffectiveTax = {
  hsnCode: "8523",
  gstRateBps: 1800,
  treatment: "TAX_EXCLUSIVE",
};

describe("variant DTO — GST public metadata (amount-free)", () => {
  it("public projection carries rate/HSN metadata but NO tax paise", () => {
    const dto = toPublicVariant(BASE, { effective: EXCLUSIVE_18 });

    expect(dto.tax).toEqual({
      hsnCode: "8523",
      gstRateBps: 1800,
      taxInclusive: false,
    });
    // Adversarial: the priced-only breakdown is structurally absent, and no
    // paise tax key survives on the public variant even from a full priced row.
    expect("taxBreakdown" in dto).toBe(false);
    const flat = JSON.stringify(dto);
    expect(flat).not.toContain("taxPaise");
    expect(flat).not.toContain("taxablePaise");
    expect(flat).not.toContain("grossPaise");
  });

  it("GST off (effective null) yields the pre-GST metadata shape", () => {
    const dto = toPublicVariant(BASE);
    expect(dto.tax).toEqual({
      hsnCode: null,
      gstRateBps: null,
      taxInclusive: false,
    });
  });
});

describe("variant DTO — priced tax breakdown", () => {
  it("matches computeLineTax and is the only place a variant tax amount appears", () => {
    const dto = toPricedVariant(BASE, { effective: EXCLUSIVE_18 });
    const expected = computeLineTax({
      amountPaise: 149900,
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
  });

  it("GST off (effective null) yields taxBreakdown null — pre-GST shape", () => {
    const dto = toPricedVariant(BASE);
    expect(dto.taxBreakdown).toBeNull();
    expect(dto.tax.gstRateBps).toBeNull();
  });
});
