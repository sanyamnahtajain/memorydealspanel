import { describe, expect, it } from "vitest";

import {
  computeLineTax,
  determineSupplyType,
  roundToRupee,
  splitTax,
  summariseOrderTax,
  type OrderTaxLine,
  type TaxTreatment,
} from "./gst";

const RATES_BPS = [0, 500, 1200, 1800, 2800] as const;
const AMOUNTS = [1, 3, 99, 100, 451, 999, 49950, 100000, 123457] as const;

describe("computeLineTax — exclusive", () => {
  it("adds tax on top of the taxable base", () => {
    expect(computeLineTax({ amountPaise: 10000, gstRateBps: 1800, treatment: "TAX_EXCLUSIVE" })).toEqual({
      taxablePaise: 10000,
      taxPaise: 1800,
      grossPaise: 11800,
    });
  });

  it("rounds the tax to the nearest paisa", () => {
    // 333 * 1800 / 10000 = 59.94 -> 60
    expect(computeLineTax({ amountPaise: 333, gstRateBps: 1800, treatment: "TAX_EXCLUSIVE" }).taxPaise).toBe(60);
  });

  it("keeps taxable === amount and gross === taxable + tax", () => {
    for (const amountPaise of AMOUNTS) {
      for (const gstRateBps of RATES_BPS) {
        const r = computeLineTax({ amountPaise, gstRateBps, treatment: "TAX_EXCLUSIVE" });
        expect(r.taxablePaise).toBe(amountPaise);
        expect(r.grossPaise).toBe(r.taxablePaise + r.taxPaise);
      }
    }
  });
});

describe("computeLineTax — inclusive", () => {
  it("backs out the taxable base from a GST-inclusive gross", () => {
    // gross 11800 @ 18% -> taxable 10000, tax 1800
    expect(computeLineTax({ amountPaise: 11800, gstRateBps: 1800, treatment: "TAX_INCLUSIVE" })).toEqual({
      taxablePaise: 10000,
      taxPaise: 1800,
      grossPaise: 11800,
    });
  });

  it("makes tax the remainder so taxable + tax === gross with NO drift", () => {
    for (const amountPaise of AMOUNTS) {
      for (const gstRateBps of RATES_BPS) {
        const r = computeLineTax({ amountPaise, gstRateBps, treatment: "TAX_INCLUSIVE" });
        expect(r.grossPaise).toBe(amountPaise);
        expect(r.taxablePaise + r.taxPaise).toBe(r.grossPaise);
        expect(r.taxPaise).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("computeLineTax — inclusive↔exclusive round trip", () => {
  it("exclusive gross fed back as inclusive recovers the taxable base", () => {
    for (const amountPaise of AMOUNTS) {
      for (const gstRateBps of RATES_BPS) {
        const excl = computeLineTax({ amountPaise, gstRateBps, treatment: "TAX_EXCLUSIVE" });
        const incl = computeLineTax({ amountPaise: excl.grossPaise, gstRateBps, treatment: "TAX_INCLUSIVE" });
        expect(incl.grossPaise).toBe(excl.grossPaise);
        expect(incl.taxablePaise + incl.taxPaise).toBe(incl.grossPaise);
        // Recovered taxable is within one paisa of the original (rounding).
        expect(Math.abs(incl.taxablePaise - amountPaise)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("computeLineTax — zero rate & zero amount", () => {
  it("0 bps yields no tax for either treatment", () => {
    for (const treatment of ["TAX_EXCLUSIVE", "TAX_INCLUSIVE"] as TaxTreatment[]) {
      const r = computeLineTax({ amountPaise: 49950, gstRateBps: 0, treatment });
      expect(r).toEqual({ taxablePaise: 49950, taxPaise: 0, grossPaise: 49950 });
    }
  });

  it("0 paise yields all zeros", () => {
    expect(computeLineTax({ amountPaise: 0, gstRateBps: 1800, treatment: "TAX_EXCLUSIVE" })).toEqual({
      taxablePaise: 0,
      taxPaise: 0,
      grossPaise: 0,
    });
    expect(computeLineTax({ amountPaise: 0, gstRateBps: 1800, treatment: "TAX_INCLUSIVE" })).toEqual({
      taxablePaise: 0,
      taxPaise: 0,
      grossPaise: 0,
    });
  });
});

describe("computeLineTax — validation", () => {
  it("rejects non-integer / negative paise", () => {
    expect(() => computeLineTax({ amountPaise: 10.5, gstRateBps: 1800, treatment: "TAX_EXCLUSIVE" })).toThrow();
    expect(() => computeLineTax({ amountPaise: -1, gstRateBps: 1800, treatment: "TAX_EXCLUSIVE" })).toThrow();
  });

  it("rejects non-integer / negative bps", () => {
    expect(() => computeLineTax({ amountPaise: 100, gstRateBps: 18.5, treatment: "TAX_EXCLUSIVE" })).toThrow();
    expect(() => computeLineTax({ amountPaise: 100, gstRateBps: -5, treatment: "TAX_EXCLUSIVE" })).toThrow();
  });
});

describe("splitTax", () => {
  it("splits INTRA into CGST/SGST with the odd paisa to SGST", () => {
    expect(splitTax(451, "INTRA")).toEqual({ supplyType: "INTRA", cgstPaise: 225, sgstPaise: 226, igstPaise: 0 });
  });

  it("keeps cgst + sgst === tax for many odd amounts (no drift)", () => {
    for (const tax of [0, 1, 3, 451, 999, 1800, 12345]) {
      const s = splitTax(tax, "INTRA");
      expect(s.cgstPaise + s.sgstPaise).toBe(tax);
      expect(s.igstPaise).toBe(0);
    }
  });

  it("routes the whole tax to IGST for INTER", () => {
    const s = splitTax(451, "INTER");
    expect(s).toEqual({ supplyType: "INTER", cgstPaise: 0, sgstPaise: 0, igstPaise: 451 });
  });

  it("rejects a bad supply type", () => {
    // @ts-expect-error deliberately invalid
    expect(() => splitTax(100, "FOO")).toThrow();
  });
});

describe("determineSupplyType", () => {
  it("returns INTRA when states match", () => {
    expect(determineSupplyType("27", "27")).toBe("INTRA");
  });

  it("returns INTER when states differ", () => {
    expect(determineSupplyType("27", "29")).toBe("INTER");
  });

  it("returns null when either side is missing/empty", () => {
    expect(determineSupplyType(null, "27")).toBeNull();
    expect(determineSupplyType("27", null)).toBeNull();
    expect(determineSupplyType(undefined, undefined)).toBeNull();
    expect(determineSupplyType("", "27")).toBeNull();
    expect(determineSupplyType("27", "  ")).toBeNull();
  });

  it("trims before comparing", () => {
    expect(determineSupplyType(" 27 ", "27")).toBe("INTRA");
  });
});

describe("roundToRupee", () => {
  it("rounds down and reports a negative round-off", () => {
    expect(roundToRupee(12340)).toEqual({ grandTotalPaise: 12300, roundOffPaise: -40 });
  });

  it("rounds up and reports a positive round-off", () => {
    expect(roundToRupee(12360)).toEqual({ grandTotalPaise: 12400, roundOffPaise: 40 });
  });

  it("rounds a half up", () => {
    expect(roundToRupee(12350)).toEqual({ grandTotalPaise: 12400, roundOffPaise: 50 });
  });

  it("leaves an exact rupee untouched", () => {
    expect(roundToRupee(12300)).toEqual({ grandTotalPaise: 12300, roundOffPaise: 0 });
  });

  it("always satisfies grandTotal − roundOff === input", () => {
    for (const paise of [0, 1, 49, 50, 99, 12345, 49950]) {
      const r = roundToRupee(paise);
      expect(r.grandTotalPaise - r.roundOffPaise).toBe(paise);
      expect(r.grandTotalPaise % 100).toBe(0);
    }
  });
});

function priced(
  amountPaise: number,
  gstRateBps: number,
  treatment: TaxTreatment,
  hsnCode: string | null,
): OrderTaxLine {
  const t = computeLineTax({ amountPaise, gstRateBps, treatment });
  return { ...t, gstRateBps, hsnCode };
}

describe("summariseOrderTax", () => {
  const lines: OrderTaxLine[] = [
    priced(10000, 1800, "TAX_EXCLUSIVE", "8504"), // taxable 10000 tax 1800
    priced(5000, 1800, "TAX_EXCLUSIVE", "8504"), // taxable 5000 tax 900 -> same group as above
    priced(20000, 1200, "TAX_EXCLUSIVE", "8517"), // taxable 20000 tax 2400
    priced(30000, 0, "TAX_EXCLUSIVE", "9999"), // zero-rated
  ];

  it("sums totals and splits INTRA per line", () => {
    const s = summariseOrderTax(lines, { supplyType: "INTRA" });
    expect(s.totalTaxablePaise).toBe(65000);
    expect(s.totalTaxPaise).toBe(1800 + 900 + 2400);
    expect(s.totalCgstPaise + s.totalSgstPaise).toBe(s.totalTaxPaise);
    expect(s.totalIgstPaise).toBe(0);
    expect(s.totalGrossPaise).toBe(65000 + 5100);
    expect(s.roundOffPaise).toBe(0);
    expect(s.grandTotalPaise).toBe(s.totalGrossPaise);
  });

  it("groups the HSN summary by (hsnCode, gstRateBps) in first-seen order", () => {
    const s = summariseOrderTax(lines, { supplyType: "INTRA" });
    expect(s.hsnSummary).toHaveLength(3);
    expect(s.hsnSummary[0]).toMatchObject({ hsnCode: "8504", gstRateBps: 1800, taxablePaise: 15000, taxPaise: 2700 });
    expect(s.hsnSummary[1]).toMatchObject({ hsnCode: "8517", gstRateBps: 1200, taxablePaise: 20000, taxPaise: 2400 });
    expect(s.hsnSummary[2]).toMatchObject({ hsnCode: "9999", gstRateBps: 0, taxablePaise: 30000, taxPaise: 0 });
    // Each grouped row keeps cgst + sgst === tax.
    for (const row of s.hsnSummary) {
      expect(row.cgstPaise + row.sgstPaise + row.igstPaise).toBe(row.taxPaise);
    }
  });

  it("routes everything to IGST for INTER supply", () => {
    const s = summariseOrderTax(lines, { supplyType: "INTER" });
    expect(s.totalCgstPaise).toBe(0);
    expect(s.totalSgstPaise).toBe(0);
    expect(s.totalIgstPaise).toBe(s.totalTaxPaise);
  });

  it("applies one invoice-level round-off in INVOICE mode", () => {
    const oddLines = [priced(12345, 1800, "TAX_EXCLUSIVE", "8504")];
    const line = oddLines[0];
    const rawGross = line.grossPaise; // 12345 + round(2222.1)=2222 = 14567
    const s = summariseOrderTax(oddLines, { supplyType: "INTRA", roundingMode: "INVOICE" });
    expect(s.totalGrossPaise).toBe(rawGross);
    expect(s.grandTotalPaise % 100).toBe(0);
    expect(s.grandTotalPaise - s.roundOffPaise).toBe(rawGross);
  });

  it("no-ops (LINE mode) on empty input", () => {
    const s = summariseOrderTax([], { supplyType: "INTRA" });
    expect(s).toMatchObject({
      totalTaxablePaise: 0,
      totalTaxPaise: 0,
      totalGrossPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 0,
      hsnSummary: [],
    });
  });

  it("groups null-HSN lines together", () => {
    const s = summariseOrderTax(
      [priced(100, 1800, "TAX_EXCLUSIVE", null), priced(200, 1800, "TAX_EXCLUSIVE", null)],
      { supplyType: "INTRA" },
    );
    expect(s.hsnSummary).toHaveLength(1);
    expect(s.hsnSummary[0].hsnCode).toBeNull();
    expect(s.hsnSummary[0].taxablePaise).toBe(300);
  });
});
