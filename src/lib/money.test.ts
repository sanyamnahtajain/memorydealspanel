import { describe, expect, it } from "vitest";
import {
  adjustPaise,
  assertPaise,
  formatPaise,
  isPaise,
  parseRupees,
} from "./money";

describe("formatPaise", () => {
  it("formats whole rupees without trailing .00", () => {
    expect(formatPaise(49900)).toBe("₹499");
    expect(formatPaise(100)).toBe("₹1");
  });

  it("formats fractional amounts with exactly two decimals", () => {
    expect(formatPaise(49950)).toBe("₹499.50");
    expect(formatPaise(49955)).toBe("₹499.55");
    expect(formatPaise(101)).toBe("₹1.01");
  });

  it("pads single-digit paise remainders", () => {
    expect(formatPaise(105)).toBe("₹1.05");
    expect(formatPaise(100005)).toBe("₹1,000.05");
  });

  it("formats zero", () => {
    expect(formatPaise(0)).toBe("₹0");
  });

  it("formats sub-rupee amounts", () => {
    expect(formatPaise(50)).toBe("₹0.50");
    expect(formatPaise(1)).toBe("₹0.01");
  });

  it("uses Indian digit grouping (lakh/crore)", () => {
    expect(formatPaise(10000000)).toBe("₹1,00,000");
    expect(formatPaise(129900)).toBe("₹1,299");
    expect(formatPaise(1000000000)).toBe("₹1,00,00,000");
    expect(formatPaise(123456789)).toBe("₹12,34,567.89");
  });

  it("handles large values precisely (no float drift)", () => {
    expect(formatPaise(999999999999)).toBe("₹9,99,99,99,999.99");
    expect(formatPaise(Number.MAX_SAFE_INTEGER - 1)).toMatch(/^₹[\d,]+\.\d{2}$/);
  });

  it("compact: formats thousands, lakhs and crores", () => {
    expect(formatPaise(150000, { compact: true })).toBe("₹1.5K");
    expect(formatPaise(15000000, { compact: true })).toBe("₹1.5L");
    expect(formatPaise(23456700, { compact: true })).toBe("₹2.35L");
    expect(formatPaise(1000000000, { compact: true })).toBe("₹1Cr");
    expect(formatPaise(1230000000, { compact: true })).toBe("₹1.23Cr");
  });

  it("compact: falls back to full format under ₹1,000", () => {
    expect(formatPaise(99900, { compact: true })).toBe("₹999");
    expect(formatPaise(49950, { compact: true })).toBe("₹499.50");
    expect(formatPaise(0, { compact: true })).toBe("₹0");
  });

  it("rejects invalid inputs", () => {
    expect(() => formatPaise(-1)).toThrow(RangeError);
    expect(() => formatPaise(1.5)).toThrow(RangeError);
    expect(() => formatPaise(Number.NaN)).toThrow(TypeError);
    expect(() => formatPaise(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("parseRupees", () => {
  it("parses plain rupee amounts", () => {
    expect(parseRupees("499")).toBe(49900);
    expect(parseRupees("0")).toBe(0);
    expect(parseRupees("1")).toBe(100);
  });

  it("parses decimals, padding one-digit fractions", () => {
    expect(parseRupees("499.5")).toBe(49950);
    expect(parseRupees("499.50")).toBe(49950);
    expect(parseRupees("0.05")).toBe(5);
    expect(parseRupees("0.5")).toBe(50);
  });

  it("accepts a currency prefix and whitespace", () => {
    expect(parseRupees("₹499.50")).toBe(49950);
    expect(parseRupees("  ₹ 1,299  ")).toBe(129900);
    expect(parseRupees("Rs. 250")).toBe(25000);
    expect(parseRupees("rs 250")).toBe(25000);
    expect(parseRupees("INR 99.99")).toBe(9999);
  });

  it("accepts Indian and Western digit grouping", () => {
    expect(parseRupees("1,299")).toBe(129900);
    expect(parseRupees("1,00,000")).toBe(10000000);
    expect(parseRupees("12,34,567.89")).toBe(123456789);
    expect(parseRupees("1,234,567")).toBe(123456700);
  });

  it("rejects malformed grouping", () => {
    expect(parseRupees("12,34")).toBeNull();
    expect(parseRupees("1,2,3")).toBeNull();
    expect(parseRupees("1,2345")).toBeNull();
    expect(parseRupees(",123")).toBeNull();
    expect(parseRupees("123,")).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseRupees("")).toBeNull();
    expect(parseRupees("   ")).toBeNull();
    expect(parseRupees("abc")).toBeNull();
    expect(parseRupees("₹")).toBeNull();
    expect(parseRupees("12abc")).toBeNull();
    expect(parseRupees("1.2.3")).toBeNull();
    expect(parseRupees("499.505")).toBeNull(); // more than 2 decimals
    expect(parseRupees(".5")).toBeNull();
    expect(parseRupees("1e5")).toBeNull();
    expect(parseRupees("0x10")).toBeNull();
  });

  it("rejects negative amounts", () => {
    expect(parseRupees("-499")).toBeNull();
    expect(parseRupees("₹-499")).toBeNull();
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(parseRupees("99999999999999999999")).toBeNull();
  });

  it("round-trips with formatPaise", () => {
    for (const paise of [0, 1, 50, 100, 49950, 129900, 10000000, 123456789]) {
      expect(parseRupees(formatPaise(paise))).toBe(paise);
    }
  });
});

describe("adjustPaise", () => {
  it("applies a positive percentage", () => {
    expect(adjustPaise(49950, { percent: 10 })).toBe(54945);
    expect(adjustPaise(10000, { percent: 5 })).toBe(10500);
  });

  it("applies a negative percentage", () => {
    expect(adjustPaise(10000, { percent: -5 })).toBe(9500);
    expect(adjustPaise(10000, { percent: -100 })).toBe(0);
  });

  it("rounds the percentage step to whole paise", () => {
    expect(adjustPaise(999, { percent: 5 })).toBe(1049); // 1048.95 -> 1049
    expect(adjustPaise(333, { percent: 10 })).toBe(366); // 366.3 -> 366
    expect(adjustPaise(101, { percent: 0.5 })).toBe(102); // 101.505 -> 102
  });

  it("applies an absolute delta", () => {
    expect(adjustPaise(49950, { delta: 50 })).toBe(50000);
    expect(adjustPaise(49950, { delta: -950 })).toBe(49000);
  });

  it("applies percent before delta", () => {
    // (10000 * 1.10) + 100 = 11100, not (10000 + 100) * 1.10
    expect(adjustPaise(10000, { percent: 10, delta: 100 })).toBe(11100);
  });

  it("no-ops with empty options", () => {
    expect(adjustPaise(49950, {})).toBe(49950);
  });

  it("throws when the result would be negative", () => {
    expect(() => adjustPaise(100, { delta: -101 })).toThrow(RangeError);
    expect(() => adjustPaise(100, { percent: -200 })).toThrow(RangeError);
  });

  it("rejects invalid inputs", () => {
    expect(() => adjustPaise(-1, { percent: 5 })).toThrow(RangeError);
    expect(() => adjustPaise(1.5, { percent: 5 })).toThrow(RangeError);
    expect(() => adjustPaise(100, { percent: Number.NaN })).toThrow(TypeError);
    expect(() => adjustPaise(100, { delta: 0.5 })).toThrow(RangeError);
    expect(() =>
      adjustPaise(Number.MAX_SAFE_INTEGER, { delta: 1 }),
    ).toThrow(RangeError);
  });
});

describe("assertPaise / isPaise", () => {
  it("accepts valid amounts", () => {
    expect(() => assertPaise(0)).not.toThrow();
    expect(() => assertPaise(49950)).not.toThrow();
    expect(() => assertPaise(Number.MAX_SAFE_INTEGER)).not.toThrow();
    expect(isPaise(0)).toBe(true);
    expect(isPaise(49950)).toBe(true);
  });

  it("rejects non-numbers with TypeError", () => {
    expect(() => assertPaise("499")).toThrow(TypeError);
    expect(() => assertPaise(null)).toThrow(TypeError);
    expect(() => assertPaise(undefined)).toThrow(TypeError);
    expect(() => assertPaise(Number.NaN)).toThrow(TypeError);
  });

  it("rejects out-of-domain numbers with RangeError", () => {
    expect(() => assertPaise(-1)).toThrow(RangeError);
    expect(() => assertPaise(1.5)).toThrow(RangeError);
    expect(() => assertPaise(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => assertPaise(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });

  it("includes the label in error messages", () => {
    expect(() => assertPaise(-1, "price")).toThrow(/price/);
  });

  it("isPaise returns false instead of throwing", () => {
    expect(isPaise(-1)).toBe(false);
    expect(isPaise(1.5)).toBe(false);
    expect(isPaise("499")).toBe(false);
    expect(isPaise(Number.NaN)).toBe(false);
  });
});
