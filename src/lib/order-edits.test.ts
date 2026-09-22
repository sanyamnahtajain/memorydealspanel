import { describe, expect, it } from "vitest";

import {
  canAdminEditOrder,
  canCustomerEditOrder,
  describeOrderChange,
  diffOrderLines,
  orderEditInputSchema,
  orderNotEditableReason,
  parseOrderChanges,
  parseOrderTotalsSnapshot,
  revisionLabel,
} from "./order-edits";

const line = (
  productId: string,
  quantity: number,
  extra: Partial<{ variantId: string | null; breakdown: { modelName: string; qty: number }[] }> = {},
) => ({
  productId,
  variantId: extra.variantId ?? null,
  name: `Product ${productId}`,
  variantLabel: null,
  quantity,
  breakdown: extra.breakdown ?? null,
});

describe("who may edit an order, and when", () => {
  it("a customer only while PLACED — the same window as cancelling", () => {
    expect(canCustomerEditOrder("PLACED")).toBe(true);
    for (const s of ["CONFIRMED", "PROCESSING", "DISPATCHED", "FULFILLED", "CANCELLED"] as const) {
      expect(canCustomerEditOrder(s)).toBe(false);
    }
  });

  it("staff until the parcel exists", () => {
    for (const s of ["PLACED", "CONFIRMED", "PROCESSING"] as const) expect(canAdminEditOrder(s)).toBe(true);
    for (const s of ["DISPATCHED", "FULFILLED", "CANCELLED"] as const) expect(canAdminEditOrder(s)).toBe(false);
  });

  it("explains a refusal in words a person can act on", () => {
    expect(orderNotEditableReason("PLACED", "customer")).toBeNull();
    expect(orderNotEditableReason("CONFIRMED", "customer")).toMatch(/contact the shop/);
    expect(orderNotEditableReason("DISPATCHED", "admin")).toMatch(/dispatched/);
    expect(orderNotEditableReason("CANCELLED", "admin")).toMatch(/cancelled/);
  });
});

describe("the edit input", () => {
  it("accepts a well-formed edit", () => {
    const ok = orderEditInputSchema.safeParse({
      expectedVersion: 1,
      lines: [{ productId: "6a50f42400f07300ab2ce6d8", variantId: null, quantity: 10 }],
      note: "pack separately",
      reason: null,
    });
    expect(ok.success).toBe(true);
  });

  it("refuses an empty order, a zero quantity, and a bogus id", () => {
    expect(orderEditInputSchema.safeParse({ expectedVersion: 1, lines: [] }).success).toBe(false);
    expect(
      orderEditInputSchema.safeParse({
        expectedVersion: 1,
        lines: [{ productId: "6a50f42400f07300ab2ce6d8", variantId: null, quantity: 0 }],
      }).success,
    ).toBe(false);
    expect(
      orderEditInputSchema.safeParse({
        expectedVersion: 1,
        lines: [{ productId: "nope", variantId: null, quantity: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("diffing two versions of an order", () => {
  it("reports quantity changes, removals and additions in reading order", () => {
    const before = [line("a", 10), line("b", 5), line("c", 2)];
    const after = [line("a", 20), line("c", 2), line("d", 1)];
    const changes = diffOrderLines(before, after);
    expect(changes.map((c) => c.kind)).toEqual(["quantity", "removed", "added"]);
    expect(changes[0]).toMatchObject({ from: 10, to: 20 });
    expect(changes[1]).toMatchObject({ name: "Product b", quantity: 5 });
    expect(changes[2]).toMatchObject({ name: "Product d", quantity: 1 });
  });

  it("treats the same product in two variants as two lines", () => {
    const before = [line("a", 10, { variantId: "v1" })];
    const after = [line("a", 10, { variantId: "v2" })];
    expect(diffOrderLines(before, after).map((c) => c.kind)).toEqual(["removed", "added"]);
  });

  it("notices a per-model split moving at the same quantity", () => {
    const before = [line("a", 10, { breakdown: [{ modelName: "iPhone 15", qty: 6 }, { modelName: "iPhone 14", qty: 4 }] })];
    const after = [line("a", 10, { breakdown: [{ modelName: "iPhone 15", qty: 4 }, { modelName: "iPhone 14", qty: 6 }] })];
    expect(diffOrderLines(before, after)).toEqual([
      expect.objectContaining({ kind: "breakdown" }),
    ]);
    // …but the same split in a different order is not a change.
    const shuffled = [line("a", 10, { breakdown: [{ modelName: "iPhone 14", qty: 4 }, { modelName: "iPhone 15", qty: 6 }] })];
    expect(diffOrderLines(before, shuffled)).toEqual([]);
  });

  it("describes each change in one line", () => {
    expect(describeOrderChange({ kind: "quantity", key: "k", name: "Cable", variantLabel: "1m", from: 10, to: 30 })).toBe("Cable — 1m: 10 → 30");
    expect(describeOrderChange({ kind: "removed", key: "k", name: "Cable", variantLabel: null, quantity: 5 })).toBe("Removed Cable (5)");
    expect(describeOrderChange({ kind: "note", from: "x", to: null })).toBe("Order note removed");
  });
});

describe("stored revision blobs are data", () => {
  it("parses what it wrote and drops what it does not know", () => {
    const changes = parseOrderChanges([
      { kind: "quantity", key: "k", name: "A", variantLabel: null, from: 1, to: 2 },
      { kind: "teleported", key: "k" },
      "garbage",
    ]);
    expect(changes).toHaveLength(1);
    expect(parseOrderTotalsSnapshot({ subtotalPaise: 100, payablePaise: "x" })).toMatchObject({
      subtotalPaise: 100,
      payablePaise: 0,
    });
    expect(parseOrderTotalsSnapshot(null)).toBeNull();
  });

  it("labels revisions for people", () => {
    expect(revisionLabel(undefined)).toBeNull();
    expect(revisionLabel(1)).toBeNull();
    expect(revisionLabel(2)).toBe("Revised once");
    expect(revisionLabel(4)).toBe("Revised 3 times");
  });
});
