import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { setOrderStatus } from "./admin-orders";
import { orderStatusMessageLines } from "@/lib/whatsapp-link";

/**
 * DISPATCHED through the real service, against the real database.
 *
 * The invariant that matters most: DISPATCHED must NOT stamp `fulfilledAt`.
 * That field is the admin-visible "completed" moment, and a dispatched order
 * is not completed — stamping it here would print a delivery date on an order
 * still in a van.
 */

const created: string[] = [];

afterEach(async () => {
  if (created.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: created } } });
    created.length = 0;
  }
});

async function seedOrder(status: "PROCESSING" | "DISPATCHED") {
  const customer = await prisma.customer.findFirst({ select: { id: true } });
  const order = await prisma.order.create({
    data: {
      orderNumber: `QA-DISP-${Date.now()}-${created.length}`,
      customerId: customer!.id,
      status,
      itemCount: 1,
      subtotalPaise: 1000,
      items: [{ productId: "x", name: "Widget", quantity: 1 }],
      placedAt: new Date(),
    },
  });
  created.push(order.id);
  return order;
}

describe("setOrderStatus → DISPATCHED", () => {
  it("moves PROCESSING → DISPATCHED without stamping fulfilledAt", async () => {
    const order = await seedOrder("PROCESSING");
    const result = await setOrderStatus(order.id, "DISPATCHED");
    expect(result.ok).toBe(true);

    const row = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, fulfilledAt: true },
    });
    expect(row?.status).toBe("DISPATCHED");
    // An order in a van is not a completed order.
    expect(row?.fulfilledAt ?? null).toBeNull();
  });

  it("DISPATCHED → FULFILLED completes it and stamps the moment", async () => {
    const order = await seedOrder("DISPATCHED");
    const result = await setOrderStatus(order.id, "FULFILLED");
    expect(result.ok).toBe(true);

    const row = await prisma.order.findUnique({
      where: { id: order.id },
      select: { status: true, fulfilledAt: true },
    });
    expect(row?.status).toBe("FULFILLED");
    expect(row?.fulfilledAt).toBeInstanceOf(Date);
  });

  it("refuses a backwards move out of DISPATCHED", async () => {
    const order = await seedOrder("DISPATCHED");
    const result = await setOrderStatus(order.id, "PROCESSING");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("illegal");
  });
});

describe("WhatsApp copy for a dispatched order", () => {
  it("mentions the tracking link when one exists, and doesn't when it doesn't", () => {
    const withTracking = orderStatusMessageLines({
      appName: "The Memory Deals",
      contactName: "Rahul",
      orderNumber: "MD-1234",
      status: "DISPATCHED",
      tracking: {
        courierName: "Delhivery",
        trackingId: "88112233",
        url: "https://track.example/88112233",
      },
    }).join(" ");
    expect(withTracking).toMatch(/dispatched/i);
    expect(withTracking).toMatch(/track/i);

    const without = orderStatusMessageLines({
      appName: "The Memory Deals",
      contactName: "Rahul",
      orderNumber: "MD-1234",
      status: "DISPATCHED",
      tracking: null,
    }).join(" ");
    expect(without).toMatch(/dispatched/i);
    expect(without).not.toMatch(/link below/i);
  });
});
