import { describe, expect, it } from "vitest";

import { MAX_QTY_PER_LINE } from "@/lib/schemas/cart";
import { DEFAULT_MAX_QTY } from "./quantity";
import {
  clampQuantity,
  maxOrderableQty,
  minOrderableQty,
  normalisePack,
  stepQtyDown,
  stepQtyUp,
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
    expect(maxOrderableQty(null)).toBe(DEFAULT_MAX_QTY);
  });

  it("aligns the cap down onto the pack", () => {
    expect(maxOrderableQty(10)).toBe(DEFAULT_MAX_QTY); // 200 is on-pack
    expect(maxOrderableQty(7)).toBe(Math.floor(DEFAULT_MAX_QTY / 7) * 7);
    expect(maxOrderableQty(7) % 7).toBe(0);
  });
});

describe("clampQuantity", () => {
  it("keeps the historical MOQ-only behaviour", () => {
    expect(clampQuantity(5, 10)).toBe(10); // below floor → floor
    expect(clampQuantity(11, 10)).toBe(11); // MOQ without pack: 11 is fine
    expect(clampQuantity(0, null)).toBe(1);
    expect(clampQuantity(Number.NaN, 10)).toBe(10);
    expect(clampQuantity(MAX_QTY_PER_LINE + 5, 10)).toBe(DEFAULT_MAX_QTY);
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
    const cap7 = Math.floor(DEFAULT_MAX_QTY / 7) * 7;
    expect(clampQuantity(MAX_QTY_PER_LINE, 1, 7)).toBe(cap7);
    expect(clampQuantity(cap7 + 1, 1, 7)).toBe(cap7);
  });

  it("survives a degenerate pack larger than the cap", () => {
    const huge = MAX_QTY_PER_LINE * 2;
    expect(clampQuantity(1, 1, huge)).toBe(huge); // one pack is the only option
  });
});

describe("admin maxQty cap (default 200)", () => {
  it("defaults to 200 when the admin sets nothing", () => {
    expect(maxOrderableQty(null, null)).toBe(DEFAULT_MAX_QTY);
    expect(clampQuantity(9999, 1, null, null)).toBe(DEFAULT_MAX_QTY);
  });

  it("the admin value always wins, in either direction", () => {
    expect(maxOrderableQty(null, 50)).toBe(50);
    expect(maxOrderableQty(null, 5000)).toBe(5000);
    expect(clampQuantity(9999, 1, null, 50)).toBe(50);
    expect(clampQuantity(9999, 1, null, 5000)).toBe(5000);
  });

  it("cap aligns down onto the pack but never below one pack", () => {
    expect(maxOrderableQty(10, 95)).toBe(90);
    expect(maxOrderableQty(10, 5)).toBe(10); // one pack minimum
  });

  it("degenerate MOQ above the cap resolves to the cap", () => {
    expect(minOrderableQty(500, null, 200)).toBe(200);
    expect(clampQuantity(1, 500, null, 200)).toBe(200);
  });

  it("junk maxQty falls back to the default", () => {
    for (const junk of [0, -5, NaN, Infinity]) {
      expect(maxOrderableQty(null, junk)).toBe(DEFAULT_MAX_QTY);
    }
    expect(maxOrderableQty(null, MAX_QTY_PER_LINE * 5)).toBe(MAX_QTY_PER_LINE);
  });
});

describe("stepQtyUp / stepQtyDown — the pack-sized stepper", () => {
  it("steps by the pack from an aligned value", () => {
    expect(stepQtyUp(10, 10)).toBe(20);
    expect(stepQtyDown(20, 10)).toBe(10);
  });

  it("repairs an off-pack value onto the nearest multiple in the direction pressed", () => {
    expect(stepQtyUp(15, 10)).toBe(20);
    expect(stepQtyDown(15, 10)).toBe(10);
    expect(stepQtyDown(11, 10)).toBe(10);
  });

  it("stepping below one pack yields 0 (callers remove the row)", () => {
    expect(stepQtyDown(10, 10)).toBe(0);
    expect(stepQtyDown(5, 10)).toBe(0);
    expect(stepQtyDown(1, 1)).toBe(0);
  });

  it("no pack means plain ±1", () => {
    expect(stepQtyUp(3, null)).toBe(4);
    expect(stepQtyDown(3, null)).toBe(2);
  });

  it("starts at one pack from zero or junk", () => {
    expect(stepQtyUp(0, 10)).toBe(10);
    expect(stepQtyUp(-4, 10)).toBe(10);
    expect(stepQtyUp(NaN, 10)).toBe(10);
    expect(stepQtyDown(NaN, 10)).toBe(0);
  });

  it("never exceeds the absolute per-line ceiling", () => {
    expect(stepQtyUp(MAX_QTY_PER_LINE, 10)).toBe(MAX_QTY_PER_LINE);
  });
});
