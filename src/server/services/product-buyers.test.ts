import { describe, expect, it } from "vitest";

import { aggregateBuyers, unitsOfProduct, type RawOrderDoc } from "./product-buyers";

const P = "aaaaaaaaaaaaaaaaaaaaaaaa";
const C1 = "bbbbbbbbbbbbbbbbbbbbbbbb";
const C2 = "cccccccccccccccccccccccc";

const doc = (over: Partial<RawOrderDoc>): RawOrderDoc => ({
  _id: { $oid: "dddddddddddddddddddddddd" },
  customerId: { $oid: C1 },
  orderNumber: "MD-1",
  status: "FULFILLED",
  placedAt: { $date: "2026-10-01T10:00:00Z" },
  items: [{ productId: P, quantity: 10 }, { productId: "other", quantity: 99 }],
  ...over,
});

describe("product buyers", () => {
  it("counts only the product's own units, ignoring other lines and junk", () => {
    expect(unitsOfProduct([{ productId: P, quantity: 3 }, { productId: P, quantity: 2 }, { productId: "x", quantity: 9 }, null, "junk"], P)).toBe(5);
    expect(unitsOfProduct("nope", P)).toBe(0);
  });

  it("folds orders into one row per customer, newest purchase first, cancelled excluded", () => {
    const { buyers, orders, units } = aggregateBuyers(
      [
        doc({ customerId: { $oid: C1 }, orderNumber: "MD-1", placedAt: { $date: "2026-10-01T10:00:00Z" } }),
        doc({ customerId: { $oid: C1 }, orderNumber: "MD-7", placedAt: { $date: "2026-10-09T10:00:00Z" }, items: [{ productId: P, quantity: 5 }] }),
        doc({ customerId: { $oid: C2 }, orderNumber: "MD-3", placedAt: { $date: "2026-10-05T10:00:00Z" } }),
        doc({ customerId: { $oid: C2 }, orderNumber: "MD-9", status: "CANCELLED", placedAt: { $date: "2026-10-20T10:00:00Z" } }),
        doc({ customerId: "not-an-id" }),
      ],
      P,
    );
    expect(orders).toBe(3);
    expect(units).toBe(25);
    expect(buyers.map((b) => [b.customerId, b.orders, b.units, b.lastOrderNumber])).toEqual([
      [C1, 2, 15, "MD-7"],
      [C2, 1, 10, "MD-3"],
    ]);
  });
});
