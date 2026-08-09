import { describe, expect, it } from "vitest";

import { MAX_QTY_PER_LINE } from "@/lib/schemas/cart";
import {
  clampQuantity,
  maxOrderableQty,
  minOrderableQty,
  normalisePack,
} from "./quantity";

describe("normalisePack", () => {
  it("treats null/undefined/0/1/negatives/NaN as 'no pack'", () => {
    expect(normalisePack(null)).toBe(1);
    expect(normalisePack(undefined)).toBe(1);
    expect(normalisePack(0)).toBe(1);
    expect(normalisePack(1)).toBe(1);
    expect(normalisePack(-5)).toBe(1);
    expect(normalisePack(Number.NaN)).toBe(1);
  });

  it("truncates and accepts integers >= 2", () => {
    expect(normalisePack(2)).toBe(2);
    expect(normalisePack(10.9)).toBe(10);
  });
});

describe("minOrderableQty", () => {
  it("is the plain MOQ without a pack", () => {
    expect(minOrderableQty(10, null)).toBe(10);
    expect(minOrderableQty(null, null)).toBe(1);
  });

  it("aligns the MOQ up onto the pack", () => {
    expect(minOrderableQty(10, 10)).toBe(10);
    expect(minOrderableQty(15, 10)).toBe(20);
    expect(minOrderableQty(1, 10)).toBe(10);
    expect(minOrderableQty(null, 6)).toBe(6);
  });
});

describe("maxOrderableQty", () => {
  it("is the raw cap without a pack", () => {
    expect(maxOrderableQty(null)).toBe(MAX_QTY_PER_LINE);
  });

  it("aligns the cap down onto the pack", () => {
    expect(maxOrderableQty(10)).toBe(MAX_QTY_PER_LINE); // 100_000 is on-pack
    expect(maxOrderableQty(7)).toBe(Math.floor(MAX_QTY_PER_LINE / 7) * 7);
    expect(maxOrderableQty(7) % 7).toBe(0);
  });
});

describe("clampQuantity", () => {
  it("keeps the historical MOQ-only behaviour", () => {
    expect(clampQuantity(5, 10)).toBe(10); // below floor → floor
    expect(clampQuantity(11, 10)).toBe(11); // MOQ without pack: 11 is fine
    expect(clampQuantity(0, null)).toBe(1);
    expect(clampQuantity(Number.NaN, 10)).toBe(10);
    expect(clampQuantity(MAX_QTY_PER_LINE + 5, 10)).toBe(MAX_QTY_PER_LINE);
  });

  it("rounds up to the next pack", () => {
    expect(clampQuantity(10, 10, 10)).toBe(10);
    expect(clampQuantity(11, 10, 10)).toBe(20);
    expect(clampQuantity(25, 10, 10)).toBe(30);
    expect(clampQuantity(1, 10, 10)).toBe(10);
  });

  it("composes MOQ and pack (floor is the aligned MOQ)", () => {
    expect(clampQuantity(1, 15, 10)).toBe(20);
    expect(clampQuantity(20, 15, 10)).toBe(20);
    expect(clampQuantity(21, 15, 10)).toBe(30);
  });

  it("keeps the cap on-pack", () => {
    const cap7 = Math.floor(MAX_QTY_PER_LINE / 7) * 7;
    expect(clampQuantity(MAX_QTY_PER_LINE, 1, 7)).toBe(cap7);
    expect(clampQuantity(cap7 + 1, 1, 7)).toBe(cap7);
  });

  it("survives a degenerate pack larger than the cap", () => {
    const huge = MAX_QTY_PER_LINE * 2;
    expect(clampQuantity(1, 1, huge)).toBe(huge); // one pack is the only option
  });
});
