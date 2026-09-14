import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { suggestCoupons } from "./coupons";

/**
 * The cart hides its coupon field when there are no coupons to offer (owner
 * request): an input whose only possible answer is "invalid code" is worse
 * than no input at all.
 *
 * The cart decides that from THIS function's result, so the rule that
 * actually matters is the one pinned here — no active coupons means nothing
 * suggested, and an active coupon means something to show.
 */

const created: string[] = [];
let deactivated: string[] = [];

afterEach(async () => {
  if (created.length > 0) {
    await prisma.coupon.deleteMany({ where: { code: { in: created } } });
    created.length = 0;
  }
  if (deactivated.length > 0) {
    await prisma.coupon.updateMany({
      where: { code: { in: deactivated } },
      data: { active: true },
    });
    deactivated = [];
  }
});

const LINES = [{ productId: "000000000000000000000001", lineTotalPaise: 100_000 }];
/** Any well-formed id: these coupons carry no per-customer limit. */
const CUSTOMER_ID = "000000000000000000000009";

describe("suggestCoupons — what the cart's coupon field keys off", () => {
  it("offers nothing when the shop has no active coupons", async () => {
    // Park any live coupons for the duration, then restore them.
    const live = await prisma.coupon.findMany({
      where: { active: true, deletedAt: null },
      select: { code: true },
    });
    deactivated = live.map((c) => c.code);
    if (deactivated.length > 0) {
      await prisma.coupon.updateMany({
        where: { code: { in: deactivated } },
        data: { active: false },
      });
    }

    const suggestions = await suggestCoupons(LINES, CUSTOMER_ID);
    expect(suggestions).toEqual([]);
  });

  it("offers a coupon once one is active — the field comes back", async () => {
    const code = `QA-SUGGEST-${Date.now()}`;
    await prisma.coupon.create({
      // EXPLICIT deletedAt — on Mongo an absent field is not null, and every
      // coupon query filters `deletedAt: null`. The real create action does the
      // same; a fixture that skips it is invisible to the very code under test.
      data: { code, kind: "PERCENT", valueBps: 1000, active: true, deletedAt: null },
    });
    created.push(code);

    const suggestions = await suggestCoupons(LINES, CUSTOMER_ID);
    expect(suggestions.some((s) => s.code === code)).toBe(true);
  });

  it("ignores an INACTIVE coupon — a paused code must not resurrect the field", async () => {
    const code = `QA-PAUSED-${Date.now()}`;
    await prisma.coupon.create({
      data: { code, kind: "PERCENT", valueBps: 1000, active: false, deletedAt: null },
    });
    created.push(code);

    const suggestions = await suggestCoupons(LINES, CUSTOMER_ID);
    expect(suggestions.some((s) => s.code === code)).toBe(false);
  });
});
