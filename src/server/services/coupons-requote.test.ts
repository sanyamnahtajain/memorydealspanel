import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { previewCoupon, requoteRedeemedCoupon } from "./coupons";

/**
 * Re-quoting an already-redeemed coupon during an order EDIT must apply the
 * coupon's arithmetic without re-running the placement checks: a code that
 * has since expired or hit its cap was still validly claimed by this order.
 */
const made: string[] = [];
afterEach(async () => {
  if (made.length) await prisma.coupon.deleteMany({ where: { id: { in: made } } });
  made.length = 0;
});

async function makeCoupon(data: Record<string, unknown>) {
  const code = `RQ${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const row = await prisma.coupon.create({
    data: {
      code,
      kind: "PERCENT",
      valueBps: 1000,
      amountPaise: null,
      minOrderPaise: 0,
      productIds: [],
      active: true,
      maxRedemptions: null,
      redemptionCount: 0,
      startsAt: null,
      expiresAt: null,
      deletedAt: null,
      ...data,
    } as never,
    select: { id: true, code: true },
  });
  made.push(row.id);
  return row.code;
}

describe("requoteRedeemedCoupon", () => {
  it("re-applies a percent coupon to the new eligible subtotal", async () => {
    const code = await makeCoupon({ kind: "PERCENT", valueBps: 1000 });
    const quote = await requoteRedeemedCoupon(code, [{ productId: "a", lineTotalPaise: 50_000 }]);
    expect(quote.discountPaise).toBe(5_000);
  });

  it("caps a fixed coupon at the eligible subtotal so an order never goes negative", async () => {
    const code = await makeCoupon({ kind: "FIXED", valueBps: null, amountPaise: 20_000 });
    expect((await requoteRedeemedCoupon(code, [{ productId: "a", lineTotalPaise: 8_000 }])).discountPaise).toBe(8_000);
    expect((await requoteRedeemedCoupon(code, [{ productId: "a", lineTotalPaise: 80_000 }])).discountPaise).toBe(20_000);
  });

  it("keeps working after the coupon EXPIRED or hit its cap — placement would refuse it", async () => {
    const code = await makeCoupon({
      kind: "PERCENT",
      valueBps: 2000,
      expiresAt: new Date(Date.now() - 60_000),
      maxRedemptions: 1,
      redemptionCount: 1,
    });
    const lines = [{ productId: "a", lineTotalPaise: 10_000 }];
    expect((await previewCoupon(code, lines)).ok).toBe(false);
    expect((await requoteRedeemedCoupon(code, lines)).discountPaise).toBe(2_000);
  });

  it("a scoped coupon discounts only its products, and nothing when none remain", async () => {
    const code = await makeCoupon({ kind: "PERCENT", valueBps: 5000, productIds: ["6a50f42400f07300ab2ce6d8"] });
    expect(
      (await requoteRedeemedCoupon(code, [
        { productId: "6a50f42400f07300ab2ce6d8", lineTotalPaise: 10_000 },
        { productId: "other", lineTotalPaise: 90_000 },
      ])).discountPaise,
    ).toBe(5_000);
    expect((await requoteRedeemedCoupon(code, [{ productId: "other", lineTotalPaise: 90_000 }])).discountPaise).toBe(0);
  });

  it("an unknown code discounts nothing", async () => {
    expect((await requoteRedeemedCoupon("NOPE-NEVER", [{ productId: "a", lineTotalPaise: 1 }])).discountPaise).toBe(0);
  });
});
