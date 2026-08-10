import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import {
  createCoupon,
  previewCoupon,
  redeemCoupon,
  suggestCoupons,
  updateCoupon,
  softDeleteCoupon,
} from "./coupons";

/**
 * Coupon service — the money-critical rules:
 *  - preview/redeem quote on the ELIGIBLE subtotal (product scoping);
 *  - a scoped coupon with nothing eligible is NOT_APPLICABLE;
 *  - the min-order floor runs on the eligible subtotal;
 *  - the exhaustion claim is ATOMIC (a 1-left code never over-redeems);
 *  - the per-customer limit counts prior orders carrying the code;
 *  - suggestions never advertise dead codes and sort applicable-first.
 *
 * Unique codes per test (time-based) — the dev DB is shared across
 * parallel suites.
 */

const createdCouponCodes: string[] = [];
const createdOrderIds: string[] = [];
const createdCustomerIds: string[] = [];

function code(prefix: string): string {
  const c = `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`
    .toUpperCase()
    .slice(0, 24);
  createdCouponCodes.push(c);
  return c;
}

const PID_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const PID_B = "bbbbbbbbbbbbbbbbbbbbbbbb";

const CART = [
  { productId: PID_A, lineTotalPaise: 100_000 }, // ₹1000 eligible target
  { productId: PID_B, lineTotalPaise: 300_000 }, // ₹3000 other lines
];

afterEach(async () => {
  if (createdOrderIds.length) {
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
    createdOrderIds.length = 0;
  }
  if (createdCustomerIds.length) {
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
    createdCustomerIds.length = 0;
  }
  if (createdCouponCodes.length) {
    await prisma.coupon.deleteMany({ where: { code: { in: createdCouponCodes } } });
    createdCouponCodes.length = 0;
  }
});

describe("preview — scoping + floors", () => {
  it("an unscoped percent coupon quotes on the whole cart", async () => {
    const c = code("ALL10");
    await createCoupon({ code: c, kind: "PERCENT", valueBps: 1000 });
    const quote = await previewCoupon(c, CART);
    expect(quote).toMatchObject({ ok: true, discountPaise: 40_000 }); // 10% of ₹4000
  });

  it("a product-scoped coupon quotes ONLY on the eligible lines", async () => {
    const c = code("AMB10");
    await createCoupon({
      code: c,
      kind: "PERCENT",
      valueBps: 1000,
      productIds: [PID_A],
    });
    const quote = await previewCoupon(c, CART);
    // 10% of the ₹1000 eligible line — the ₹3000 of other products is ignored.
    expect(quote).toMatchObject({ ok: true, discountPaise: 10_000, scopeProductIds: [PID_A] });
  });

  it("scoped + nothing eligible → NOT_APPLICABLE; scoped min runs on the eligible subtotal", async () => {
    const c = code("SCOPE");
    await createCoupon({
      code: c,
      kind: "FIXED",
      amountPaise: 5_000,
      minOrderPaise: 200_000, // ₹2000 min, but only ₹1000 is eligible
      productIds: [PID_A],
    });
    expect(await previewCoupon(c, [CART[1]])).toEqual({ ok: false, reason: "NOT_APPLICABLE" });
    expect(await previewCoupon(c, CART)).toEqual({ ok: false, reason: "MIN_ORDER" });
  });

  it("a FIXED discount caps at the eligible subtotal (never negative)", async () => {
    const c = code("BIGFLAT");
    await createCoupon({
      code: c,
      kind: "FIXED",
      amountPaise: 10_000_000,
      productIds: [PID_A],
    });
    const quote = await previewCoupon(c, CART);
    expect(quote).toMatchObject({ ok: true, discountPaise: 100_000 });
  });

  it("inactive / expired / unknown codes refuse with their reason", async () => {
    const c = code("DEAD");
    await createCoupon({ code: c, kind: "PERCENT", valueBps: 500, active: false });
    expect(await previewCoupon(c, CART)).toEqual({ ok: false, reason: "INACTIVE" });
    expect(await previewCoupon("NO-SUCH-CODE", CART)).toEqual({ ok: false, reason: "NOT_FOUND" });
    const e = code("EXP");
    await createCoupon({
      code: e,
      kind: "PERCENT",
      valueBps: 500,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await previewCoupon(e, CART)).toEqual({ ok: false, reason: "EXPIRED" });
  });
});

describe("redeem — atomic exhaustion + per-customer limit", () => {
  it("a 1-left coupon never over-redeems under concurrency", async () => {
    const c = code("LAST1");
    await createCoupon({ code: c, kind: "PERCENT", valueBps: 500, maxRedemptions: 1 });
    const [r1, r2] = await Promise.all([
      redeemCoupon(c, CART, "aaaaaaaaaaaaaaaaaaaaaaa1"),
      redeemCoupon(c, CART, "aaaaaaaaaaaaaaaaaaaaaaa2"),
    ]);
    const wins = [r1, r2].filter((r) => r.ok).length;
    expect(wins).toBe(1);
    const row = await prisma.coupon.findFirst({ where: { code: c } });
    expect(row?.redemptionCount).toBe(1);
    // A third attempt is cleanly EXHAUSTED.
    expect(await redeemCoupon(c, CART, "aaaaaaaaaaaaaaaaaaaaaaa3")).toEqual({ ok: false, reason: "EXHAUSTED" });
  });

  it("the per-customer limit counts prior orders carrying the code", async () => {
    const c = code("ONCE");
    await createCoupon({ code: c, kind: "PERCENT", valueBps: 500, perCustomerLimit: 1 });
    const customer = await prisma.customer.create({
      data: {
        businessName: "Coupon Test Traders",
        contactName: "C Test",
        phone: `+9166${String((Date.now() + Math.floor(Math.random() * 1e7)) % 1_00_00_00_000).padStart(10, "0")}`,
        passwordHash: "x".repeat(60),
        status: "APPROVED",
      },
      select: { id: true },
    });
    createdCustomerIds.push(customer.id);
    const order = await prisma.order.create({
      data: {
        orderNumber: `MD-TEST${Date.now().toString(36).toUpperCase()}`,
        customerId: customer.id,
        status: "PLACED",
        items: [],
        subtotalPaise: 1000,
        itemCount: 1,
        couponCode: c,
        discountPaise: 50,
      },
      select: { id: true },
    });
    createdOrderIds.push(order.id);

    expect(await redeemCoupon(c, CART, customer.id)).toEqual({
      ok: false,
      reason: "PER_CUSTOMER_LIMIT",
    });
    // A different customer still redeems fine (any valid ObjectId).
    const other = await redeemCoupon(c, CART, "cccccccccccccccccccccccc");
    expect(other.ok).toBe(true);
  });
});

describe("suggestions", () => {
  it("sorts applicable-first, carries reasons, hides dead codes", async () => {
    const good = code("GOOD");
    const minBlocked = code("MINB");
    const dead = code("OFF");
    await createCoupon({ code: good, kind: "PERCENT", valueBps: 1000 });
    await createCoupon({
      code: minBlocked,
      kind: "FIXED",
      amountPaise: 10_000,
      minOrderPaise: 100_000_000, // far above the cart
    });
    await createCoupon({ code: dead, kind: "PERCENT", valueBps: 500, active: false });

    const out = await suggestCoupons(CART, "dddddddddddddddddddddddd");
    const codes = out.map((s) => s.code);
    expect(codes).toContain(good);
    expect(codes).toContain(minBlocked);
    expect(codes).not.toContain(dead);

    const goodSug = out.find((s) => s.code === good)!;
    const minSug = out.find((s) => s.code === minBlocked)!;
    expect(goodSug.applicable).toBe(true);
    expect(goodSug.discountPaise).toBe(40_000);
    expect(minSug.applicable).toBe(false);
    expect(minSug.reason).toBe("MIN_ORDER");
    expect(codes.indexOf(good)).toBeLessThan(codes.indexOf(minBlocked));
  });
});

describe("write rules", () => {
  it("duplicate codes refuse; update never changes the code; delete retires", async () => {
    const c = code("DUP");
    const first = await createCoupon({ code: c, kind: "PERCENT", valueBps: 500 });
    expect(first.ok).toBe(true);
    const dup = await createCoupon({ code: c, kind: "FIXED", amountPaise: 100 });
    expect(dup).toMatchObject({ ok: false, error: "CODE_TAKEN" });

    if (!first.ok) return;
    const updated = await updateCoupon(first.coupon.id, {
      kind: "FIXED",
      amountPaise: 2_500,
      productIds: [PID_A],
    });
    expect(updated).toMatchObject({ ok: true });
    if (updated.ok) {
      expect(updated.coupon.code).toBe(c);
      expect(updated.coupon.amountPaise).toBe(2_500);
      expect(updated.coupon.valueBps).toBeNull();
      expect(updated.coupon.productIds).toEqual([PID_A]);
    }

    await softDeleteCoupon(first.coupon.id);
    expect(await previewCoupon(c, CART)).toEqual({ ok: false, reason: "NOT_FOUND" });
  });
});
