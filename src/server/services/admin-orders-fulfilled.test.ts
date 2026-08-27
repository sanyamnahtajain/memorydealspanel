import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { setOrderStatus } from "./admin-orders";

/**
 * fulfilledAt — the admin-visible "completed" moment.
 *
 * Contract: stamped exactly once, on the transition INTO FULFILLED, and
 * never moved by later edits (that's why updatedAt could not serve). Legacy
 * fulfilled orders (stamped before the field existed) stay null and the UI
 * shows nothing rather than a guessed date.
 */

const createdIds: string[] = [];

afterEach(async () => {
  if (createdIds.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  }
});

async function seedOrder(status: "PLACED" | "CONFIRMED" | "PROCESSING") {
  const customer = await prisma.customer.findFirst({ select: { id: true } });
  const order = await prisma.order.create({
    data: {
      orderNumber: `QA-FUL-${Date.now()}-${createdIds.length}`,
      customerId: customer!.id,
      status,
      itemCount: 1,
      subtotalPaise: 1000,
      items: [{ productId: "x", name: "Widget", quantity: 1 }],
      placedAt: new Date(),
    },
  });
  createdIds.push(order.id);
  return order;
}

describe("setOrderStatus → fulfilledAt", () => {
  it("stamps fulfilledAt on the transition into FULFILLED", async () => {
    const order = await seedOrder("PROCESSING");
    const before = Date.now();
    const result = await setOrderStatus(order.id, "FULFILLED");
    expect(result.ok).toBe(true);

    const row = await prisma.order.findUnique({
      where: { id: order.id },
      select: { fulfilledAt: true, status: true },
    });
    expect(row?.status).toBe("FULFILLED");
    expect(row?.fulfilledAt).toBeInstanceOf(Date);
    expect(row!.fulfilledAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it("does NOT stamp on other transitions", async () => {
    const order = await seedOrder("PLACED");
    const result = await setOrderStatus(order.id, "CONFIRMED");
    expect(result.ok).toBe(true);

    const row = await prisma.order.findUnique({
      where: { id: order.id },
      select: { fulfilledAt: true },
    });
    expect(row?.fulfilledAt ?? null).toBeNull();
  });
});
