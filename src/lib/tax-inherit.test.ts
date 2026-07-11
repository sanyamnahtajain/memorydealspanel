import { describe, expect, it } from "vitest";

import {
  resolveEffectiveTax,
  resolveVariantEffectiveTax,
  type ProfileTaxDefaults,
} from "./tax-inherit";

const profile: ProfileTaxDefaults = {
  defaultHsnCode: "8517",
  defaultGstRateBps: 1800,
  priceEntryMode: "TAX_EXCLUSIVE",
};

describe("resolveEffectiveTax", () => {
  it("falls back entirely to the profile when nothing is set", () => {
    expect(
      resolveEffectiveTax({ entity: {}, category: null, profile }),
    ).toEqual({
      hsnCode: "8517",
      gstRateBps: 1800,
      treatment: "TAX_EXCLUSIVE",
    });
  });

  it("prefers the entity value over category and profile, per field", () => {
    expect(
      resolveEffectiveTax({
        entity: { hsnCode: "8544", gstRateBps: 500, taxTreatment: "TAX_INCLUSIVE" },
        category: { defaultHsnCode: "9999", defaultGstRateBps: 1200 },
        profile,
      }),
    ).toEqual({
      hsnCode: "8544",
      gstRateBps: 500,
      treatment: "TAX_INCLUSIVE",
    });
  });

  it("resolves each field independently (HSN from entity, rate from category)", () => {
    expect(
      resolveEffectiveTax({
        entity: { hsnCode: "8544", gstRateBps: null },
        category: { defaultHsnCode: "9999", defaultGstRateBps: 1200 },
        profile,
      }),
    ).toEqual({
      hsnCode: "8544",
      gstRateBps: 1200,
      treatment: "TAX_EXCLUSIVE",
    });
  });

  it("uses category defaults when the entity is empty", () => {
    expect(
      resolveEffectiveTax({
        entity: {},
        category: { defaultHsnCode: "9999", defaultGstRateBps: 1200 },
        profile,
      }),
    ).toEqual({
      hsnCode: "9999",
      gstRateBps: 1200,
      treatment: "TAX_EXCLUSIVE",
    });
  });

  it("treats blank / whitespace HSN as unset and falls through", () => {
    expect(
      resolveEffectiveTax({
        entity: { hsnCode: "   " },
        category: { defaultHsnCode: "" },
        profile,
      }).hsnCode,
    ).toBe("8517");
  });

  it("trims a valid HSN code", () => {
    expect(
      resolveEffectiveTax({ entity: { hsnCode: "  8544 " }, profile }).hsnCode,
    ).toBe("8544");
  });

  it("accepts a 0 bps (exempt) rate as an explicit override", () => {
    expect(
      resolveEffectiveTax({
        entity: { gstRateBps: 0 },
        category: { defaultGstRateBps: 1200 },
        profile,
      }).gstRateBps,
    ).toBe(0);
  });

  it("ignores negative / non-integer / NaN bps and falls through", () => {
    expect(
      resolveEffectiveTax({
        entity: { gstRateBps: -5 },
        category: { defaultGstRateBps: 1200 },
        profile,
      }).gstRateBps,
    ).toBe(1200);
    expect(
      resolveEffectiveTax({
        entity: { gstRateBps: 12.5 },
        profile,
      }).gstRateBps,
    ).toBe(1800);
    expect(
      resolveEffectiveTax({ entity: { gstRateBps: Number.NaN }, profile })
        .gstRateBps,
    ).toBe(1800);
  });

  it("resolves HSN to null when nothing is configured anywhere", () => {
    expect(
      resolveEffectiveTax({
        entity: {},
        category: null,
        profile: { defaultGstRateBps: 1800, priceEntryMode: "TAX_EXCLUSIVE" },
      }).hsnCode,
    ).toBeNull();
  });

  it("always yields a concrete treatment from the profile backstop", () => {
    expect(
      resolveEffectiveTax({
        entity: { taxTreatment: null },
        profile: { defaultGstRateBps: 1800, priceEntryMode: "TAX_INCLUSIVE" },
      }).treatment,
    ).toBe("TAX_INCLUSIVE");
  });
});

describe("resolveVariantEffectiveTax", () => {
  it("prefers the variant over the product, then category, then profile", () => {
    expect(
      resolveVariantEffectiveTax({
        variant: { hsnCode: "1111", gstRateBps: 500 },
        product: { hsnCode: "2222", gstRateBps: 1200, taxTreatment: "TAX_INCLUSIVE" },
        category: { defaultHsnCode: "3333", defaultGstRateBps: 2800 },
        profile,
      }),
    ).toEqual({
      hsnCode: "1111",
      gstRateBps: 500,
      treatment: "TAX_INCLUSIVE", // inherited from product
    });
  });

  it("inherits from the product when the variant leaves fields unset", () => {
    expect(
      resolveVariantEffectiveTax({
        variant: {},
        product: { hsnCode: "2222", gstRateBps: 1200 },
        category: { defaultHsnCode: "3333", defaultGstRateBps: 2800 },
        profile,
      }),
    ).toEqual({
      hsnCode: "2222",
      gstRateBps: 1200,
      treatment: "TAX_EXCLUSIVE",
    });
  });

  it("falls through variant → product → category when both are unset", () => {
    expect(
      resolveVariantEffectiveTax({
        variant: {},
        product: {},
        category: { defaultHsnCode: "3333", defaultGstRateBps: 2800 },
        profile,
      }),
    ).toEqual({
      hsnCode: "3333",
      gstRateBps: 2800,
      treatment: "TAX_EXCLUSIVE",
    });
  });

  it("falls all the way through to the profile", () => {
    expect(
      resolveVariantEffectiveTax({
        variant: {},
        product: {},
        category: null,
        profile,
      }),
    ).toEqual({
      hsnCode: "8517",
      gstRateBps: 1800,
      treatment: "TAX_EXCLUSIVE",
    });
  });

  it("lets a variant 0-bps override a product's non-zero rate", () => {
    expect(
      resolveVariantEffectiveTax({
        variant: { gstRateBps: 0 },
        product: { gstRateBps: 1800 },
        profile,
      }).gstRateBps,
    ).toBe(0);
  });
});
