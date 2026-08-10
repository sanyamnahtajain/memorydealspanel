import { describe, expect, it } from "vitest";
import { allocateDiscount } from "./discount";

/**
 * allocateDiscount — the integer-exact proportional split behind coupon
 * discounts. Invariants: the allocations sum EXACTLY to the discount, no
 * line goes negative, zero-total lines get nothing (scoped coupons pass
 * ineligible lines as 0).
 */

describe("allocateDiscount", () => {
  it("splits proportionally and sums exactly (largest remainder)", () => {
    const alloc = allocateDiscount([10000, 20000, 30000], 999);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(999);
    // Rough proportionality: the 30k line carries about half.
    expect(alloc[2]).toBeGreaterThan(alloc[0]);
  });

  it("never exceeds a line's total and zero lines stay zero", () => {
    const totals = [500, 0, 500];
    const alloc = allocateDiscount(totals, 1000);
    expect(alloc).toEqual([500, 0, 500]);
  });

  it("scoped shape: ineligible lines passed as 0 receive nothing", () => {
    // 20-line cart, only 2 eligible (the AMBRANE10 scenario).
    const totals = Array.from({ length: 20 }, (_, i) =>
      i === 3 || i === 11 ? 50000 : 0,
    );
    const alloc = allocateDiscount(totals, 10000);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(10000);
    for (let i = 0; i < 20; i++) {
      if (i === 3 || i === 11) expect(alloc[i]).toBe(5000);
      else expect(alloc[i]).toBe(0);
    }
  });

  it("zero discount allocates nothing; overdraw throws", () => {
    expect(allocateDiscount([100, 200], 0)).toEqual([0, 0]);
    expect(() => allocateDiscount([100, 200], 301)).toThrow(RangeError);
    expect(() => allocateDiscount([100], 50.5)).toThrow(RangeError);
  });

  it("every paisa lands somewhere on awkward ratios", () => {
    const totals = [333, 333, 334];
    for (const d of [1, 2, 3, 10, 100, 999, 1000]) {
      const alloc = allocateDiscount(totals, d);
      expect(alloc.reduce((a, b) => a + b, 0)).toBe(d);
      alloc.forEach((a, i) => {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(totals[i]);
      });
    }
  });
});
