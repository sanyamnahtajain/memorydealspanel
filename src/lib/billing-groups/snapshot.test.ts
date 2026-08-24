import { describe, expect, it } from "vitest";

import { bucketizeLines } from "./engine";
import {
  BILLING_SNAPSHOT_VERSION,
  lineKey,
  parseOrderBillingSnapshot,
  toOrderBillingSnapshot,
} from "./snapshot";
import type { BillingGroupConfig } from "./types";

const DEALER: BillingGroupConfig = {
  id: "g1",
  name: "Dealer brands",
  code: "DLR",
  color: "blue",
  active: true,
  sortOrder: 0,
  matcher: { kind: "brands", brandIds: ["zeb"] },
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
  notes: "Dealer terms",
};

describe("lineKey", () => {
  it("is stable and variant-aware", () => {
    expect(lineKey("p1", null)).toBe("p1:");
    expect(lineKey("p1", undefined)).toBe("p1:");
    expect(lineKey("p1", "v2")).toBe("p1:v2");
  });
});

describe("toOrderBillingSnapshot", () => {
  it("is null for a plain General-only cart (nothing to freeze)", () => {
    const cart = bucketizeLines([{ key: "a:", brandId: null, lineTotalPaise: 100 }], []);
    expect(toOrderBillingSnapshot(cart)).toBeNull();
  });

  it("freezes buckets, per-line discounts and the applied tier", () => {
    const cart = bucketizeLines(
      [
        { key: "a:", brandId: "zeb", lineTotalPaise: 10_000_00 },
        { key: "b:", brandId: null, lineTotalPaise: 500_00 },
      ],
      [DEALER],
    );
    const snap = toOrderBillingSnapshot(cart);
    expect(snap).not.toBeNull();
    expect(snap!.version).toBe(BILLING_SNAPSHOT_VERSION);
    expect(snap!.groupDiscountPaise).toBe(400_00);
    expect(snap!.buckets.map((b) => b.code)).toEqual(["DLR", "GEN"]);
    const dlr = snap!.buckets[0];
    expect(dlr.lineKeys).toEqual(["a:"]);
    expect(dlr.lineDiscounts).toEqual({ "a:": 400_00 });
    expect(dlr.appliedTier).toEqual({ fromPaise: 0, percentBps: 400 });
    expect(dlr.notes).toBe("Dealer terms");
    expect(dlr.separateBill).toBe(true);
  });
});

describe("parseOrderBillingSnapshot", () => {
  it("round-trips a snapshot through JSON", () => {
    const cart = bucketizeLines(
      [{ key: "a:", brandId: "zeb", lineTotalPaise: 30_000_00 }],
      [DEALER],
    );
    const snap = toOrderBillingSnapshot(cart)!;
    const parsed = parseOrderBillingSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed).toEqual(snap);
  });

  it("rejects garbage / old shapes (null → render as before)", () => {
    expect(parseOrderBillingSnapshot(null)).toBeNull();
    expect(parseOrderBillingSnapshot(undefined)).toBeNull();
    expect(parseOrderBillingSnapshot("x")).toBeNull();
    expect(parseOrderBillingSnapshot({})).toBeNull();
    expect(parseOrderBillingSnapshot({ version: 99, buckets: [] })).toBeNull();
    expect(parseOrderBillingSnapshot({ version: 1, buckets: [{ code: 1 }] })).toBeNull();
  });

  it("fills defaults for optional fields", () => {
    const parsed = parseOrderBillingSnapshot({
      version: 1,
      buckets: [
        { code: "X", name: "X group", lineKeys: ["a:"], subtotalPaise: 100, discountPaise: 10 },
      ],
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.buckets[0].color).toBe("slate");
    expect(parsed!.buckets[0].netPaise).toBe(90);
    expect(parsed!.subtotalPaise).toBe(100);
    expect(parsed!.groupDiscountPaise).toBe(10);
  });
});
