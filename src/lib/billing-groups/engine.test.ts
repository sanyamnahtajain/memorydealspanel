import { describe, expect, it } from "vitest";

import {
  allocateDiscount,
  applyRules,
  bucketBillNumber,
  bucketizeLines,
  percentOfPaise,
  resolveGroupForLine,
  resolveTier,
} from "./engine";
import type { BillingGroupConfig, BucketableLine } from "./types";

/** Raghav's rule: dealer brands, 4% under ₹25,000, 6% at/above. */
const DEALER: BillingGroupConfig = {
  id: "g-dealer",
  name: "Dealer brands",
  code: "DLR",
  color: "blue",
  active: true,
  sortOrder: 0,
  matcher: { kind: "brands", brandIds: ["zebronics", "ambrane", "erd", "digitek", "portronics"] },
  rules: [
    {
      kind: "tieredPercent",
      tiers: [
        { fromPaise: 0, percentBps: 400 },
        { fromPaise: 25_000_00, percentBps: 600 },
      ],
    },
  ],
  separateBill: true,
  couponStacking: true,
  notes: null,
};

const line = (key: string, brandId: string | null, rupees: number): BucketableLine => ({
  key,
  brandId,
  lineTotalPaise: rupees * 100,
});

describe("resolveTier", () => {
  const tiers = DEALER.rules[0].kind === "tieredPercent" ? DEALER.rules[0].tiers : [];

  it("4% below ₹25,000 and shows the 6% tier as next", () => {
    const r = resolveTier(tiers, 10_000_00);
    expect(r.applied?.percentBps).toBe(400);
    expect(r.next).toEqual({
      tier: { fromPaise: 25_000_00, percentBps: 600 },
      remainingPaise: 15_000_00,
    });
  });

  it("EXACTLY ₹25,000 is 6% (inclusive floor)", () => {
    const r = resolveTier(tiers, 25_000_00);
    expect(r.applied?.percentBps).toBe(600);
    expect(r.next).toBeNull();
  });

  it("one paisa under ₹25,000 is still 4%", () => {
    expect(resolveTier(tiers, 25_000_00 - 1).applied?.percentBps).toBe(400);
  });

  it("above ₹25,000 is 6% with nothing further to unlock", () => {
    const r = resolveTier(tiers, 90_000_00);
    expect(r.applied?.percentBps).toBe(600);
    expect(r.next).toBeNull();
  });

  it("no tier applies below the lowest floor, and the lowest becomes 'next'", () => {
    const r = resolveTier([{ fromPaise: 5_000_00, percentBps: 300 }], 1_000_00);
    expect(r.applied).toBeNull();
    expect(r.next?.remainingPaise).toBe(4_000_00);
  });

  it("is order-independent (unsorted tiers)", () => {
    const r = resolveTier(
      [
        { fromPaise: 25_000_00, percentBps: 600 },
        { fromPaise: 0, percentBps: 400 },
      ],
      30_000_00,
    );
    expect(r.applied?.percentBps).toBe(600);
  });
});

describe("percentOfPaise / allocateDiscount", () => {
  it("rounds half-up in paise", () => {
    expect(percentOfPaise(10_000_00, 400)).toBe(400_00);
    expect(percentOfPaise(333, 400)).toBe(13); // 13.32 → 13
    expect(percentOfPaise(338, 400)).toBe(14); // 13.52 → 14
  });

  it("allocates a discount across lines and always sums EXACTLY", () => {
    const lines = [line("a", "x", 10), line("b", "x", 10), line("c", "x", 10)];
    const alloc = allocateDiscount(lines, 100); // ₹1 across three ₹10 lines
    const sum = alloc.reduce((s, l) => s + l.discountPaise, 0);
    expect(sum).toBe(100);
    // 33.33… each → floors 33,33,33 + 1 leftover to the first by index tie-break.
    expect(alloc.map((l) => l.discountPaise)).toEqual([34, 33, 33]);
    expect(alloc.map((l) => l.netPaise)).toEqual([966, 967, 967]);
  });

  it("gives proportionally more to bigger lines", () => {
    const alloc = allocateDiscount([line("a", "x", 300), line("b", "x", 100)], 40_00);
    expect(alloc.map((l) => l.discountPaise)).toEqual([30_00, 10_00]);
  });

  it("never exceeds the subtotal and never exceeds a line's total", () => {
    const alloc = allocateDiscount([line("a", "x", 1), line("b", "x", 1)], 5_00);
    expect(alloc.reduce((s, l) => s + l.discountPaise, 0)).toBe(2_00);
    for (const l of alloc) expect(l.discountPaise).toBeLessThanOrEqual(l.lineTotalPaise);
  });

  it("zero discount is a clean pass-through", () => {
    const alloc = allocateDiscount([line("a", "x", 5)], 0);
    expect(alloc[0]).toEqual({ key: "a", lineTotalPaise: 500, discountPaise: 0, netPaise: 500 });
  });
});

describe("applyRules", () => {
  it("caps the total discount at the subtotal", () => {
    const r = applyRules(
      [{ kind: "tieredPercent", tiers: [{ fromPaise: 0, percentBps: 10_000 }] }],
      1_000,
    );
    expect(r.discountPaise).toBe(1_000);
  });

  it("no rules → no discount", () => {
    expect(applyRules([], 10_000).discountPaise).toBe(0);
  });
});

describe("bucketizeLines", () => {
  it("with NO groups, everything is one General bucket with zero discount (today's behaviour)", () => {
    const cart = bucketizeLines([line("a", "zebronics", 100), line("b", null, 50)], []);
    expect(cart.buckets).toHaveLength(1);
    expect(cart.buckets[0].code).toBe("GEN");
    expect(cart.buckets[0].discountPaise).toBe(0);
    expect(cart.isSplit).toBe(false);
    expect(cart.subtotalPaise).toBe(150_00);
    expect(cart.netPaise).toBe(150_00);
  });

  it("an INACTIVE group is ignored entirely (the kill switch)", () => {
    const cart = bucketizeLines([line("a", "zebronics", 100)], [{ ...DEALER, active: false }]);
    expect(cart.buckets.map((b) => b.code)).toEqual(["GEN"]);
    expect(cart.groupDiscountPaise).toBe(0);
  });

  it("splits dealer brands from everything else, General last", () => {
    const cart = bucketizeLines(
      [
        line("1", "boat", 1_000),
        line("2", "zebronics", 10_000),
        line("3", "ambrane", 5_000),
        line("4", null, 200),
      ],
      [DEALER],
    );
    expect(cart.buckets.map((b) => b.code)).toEqual(["DLR", "GEN"]);
    expect(cart.isSplit).toBe(true);

    const dlr = cart.buckets[0];
    expect(dlr.subtotalPaise).toBe(15_000_00);
    expect(dlr.appliedTier?.percentBps).toBe(400);
    expect(dlr.discountPaise).toBe(600_00); // 4% of ₹15,000
    expect(dlr.nextTier?.remainingPaise).toBe(10_000_00);
    expect(dlr.netPaise).toBe(14_400_00);
    expect(dlr.lines.map((l) => l.key)).toEqual(["2", "3"]);
    expect(dlr.lines.reduce((s, l) => s + l.discountPaise, 0)).toBe(600_00);

    const gen = cart.buckets[1];
    expect(gen.subtotalPaise).toBe(1_200_00);
    expect(gen.discountPaise).toBe(0);
    expect(gen.appliedTier).toBeNull();

    expect(cart.subtotalPaise).toBe(16_200_00);
    expect(cart.groupDiscountPaise).toBe(600_00);
    expect(cart.netPaise).toBe(15_600_00);
  });

  it("crossing ₹25,000 in the dealer bucket flips it to 6%", () => {
    const cart = bucketizeLines(
      [line("1", "zebronics", 20_000), line("2", "erd", 5_000)],
      [DEALER],
    );
    const dlr = cart.buckets[0];
    expect(dlr.subtotalPaise).toBe(25_000_00);
    expect(dlr.appliedTier?.percentBps).toBe(600);
    expect(dlr.discountPaise).toBe(1_500_00);
    expect(dlr.nextTier).toBeNull();
  });

  it("the tier is judged on the BUCKET subtotal, not the whole cart", () => {
    // ₹24,000 dealer + ₹10,000 other = ₹34,000 cart, but the dealer bucket is under ₹25,000 → 4%.
    const cart = bucketizeLines(
      [line("1", "zebronics", 24_000), line("2", "boat", 10_000)],
      [DEALER],
    );
    expect(cart.buckets[0].appliedTier?.percentBps).toBe(400);
  });

  it("omits empty buckets (no dealer brands → no DLR bucket)", () => {
    const cart = bucketizeLines([line("1", "boat", 10)], [DEALER]);
    expect(cart.buckets.map((b) => b.code)).toEqual(["GEN"]);
  });

  it("overlapping brands resolve to the group sorted FIRST", () => {
    const other: BillingGroupConfig = {
      ...DEALER,
      id: "g-other",
      name: "Other",
      code: "OTH",
      sortOrder: 1,
      matcher: { kind: "brands", brandIds: ["zebronics"] },
    };
    const l = line("1", "zebronics", 10);
    expect(resolveGroupForLine(l, [other, DEALER])?.id).toBe("g-dealer");
    expect(resolveGroupForLine(l, [{ ...DEALER, sortOrder: 5 }, other])?.id).toBe("g-other");
  });

  it("carries bucket metadata for billing (code, separateBill, notes)", () => {
    const cart = bucketizeLines([line("1", "zebronics", 10)], [{ ...DEALER, notes: "Dealer terms" }]);
    const dlr = cart.buckets[0];
    expect(dlr.separateBill).toBe(true);
    expect(dlr.notes).toBe("Dealer terms");
    expect(bucketBillNumber("MD-A1B2", dlr.code)).toBe("MD-A1B2/DLR");
  });
});
