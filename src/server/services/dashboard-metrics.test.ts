import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerContext } from "@/server/types/viewer";

/**
 * Integration tests for the dashboard-metrics aggregations against the SEEDED
 * local MongoDB.
 *
 * The metrics are admin-guarded via `resolveViewer` + `assertAdmin`, so we mock
 * `resolveViewer` to swap the acting viewer per test — proving both the guard
 * (non-admins are rejected) and the day-bucketing logic (self-created rows land
 * in the right bucket and are cleaned up afterwards, leaving the seed intact).
 */

const viewerMock = vi.hoisted(() => ({
  current: null as ViewerContext | null,
}));

vi.mock("@/server/auth/viewer", () => ({
  resolveViewer: vi.fn(async () => {
    if (!viewerMock.current) throw new Error("no viewer set in test");
    return viewerMock.current;
  }),
}));

const ADMIN_VIEWER: ViewerContext = {
  kind: "admin",
  adminId: "test-admin-metrics",
  name: "Metrics Test Admin",
  roleId: null,
  permissions: ["*"],
};

const ANON_VIEWER: ViewerContext = { kind: "anon" };

import { prisma } from "@/server/db";
import { isForbiddenError } from "@/server/dal/guard";
import {
  accessRequestsOverTime,
  customersByStatus,
  ordersOverTime,
  orderStatusBreakdown,
  topOrderedProducts,
} from "./dashboard-metrics";

/** Track ids we create so each test leaves the seed untouched. */
const createdRequestIds: string[] = [];
let testCustomerId: string | null = null;

beforeEach(() => {
  viewerMock.current = ADMIN_VIEWER;
});

afterEach(async () => {
  if (createdRequestIds.length > 0) {
    await prisma.accessRequest.deleteMany({
      where: { id: { in: createdRequestIds } },
    });
    createdRequestIds.length = 0;
  }
  if (testCustomerId) {
    await prisma.customer.deleteMany({ where: { id: testCustomerId } });
    testCustomerId = null;
  }
});

describe("dashboard-metrics guard", () => {
  it("rejects a non-admin viewer with a ForbiddenError", async () => {
    viewerMock.current = ANON_VIEWER;
    await expect(customersByStatus()).rejects.toSatisfy(isForbiddenError);
  });
});

describe("accessRequestsOverTime", () => {
  it("returns one bucket per day for the window, ordered oldest → newest", async () => {
    const buckets = await accessRequestsOverTime(30);
    expect(buckets).toHaveLength(30);
    // Dates strictly increase and the last bucket is today (UTC).
    for (let i = 1; i < buckets.length; i++) {
      expect(buckets[i].date > buckets[i - 1].date).toBe(true);
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    expect(buckets[buckets.length - 1].date).toBe(todayIso);
  });

  it("counts a freshly-created request in today's bucket", async () => {
    // A throwaway customer to satisfy the AccessRequest → Customer relation.
    const customer = await prisma.customer.create({
      data: {
        businessName: `Metrics Test Co ${Date.now()}`,
        contactName: "Test Contact",
        phone: `test-metrics-${Date.now()}`,
        passwordHash: "x",
      },
      select: { id: true },
    });
    testCustomerId = customer.id;

    const before = await accessRequestsOverTime(30);
    const todayIso = new Date().toISOString().slice(0, 10);
    const beforeToday =
      before.find((b) => b.date === todayIso)?.count ?? 0;

    const request = await prisma.accessRequest.create({
      data: { customerId: customer.id, status: "PENDING" },
      select: { id: true },
    });
    createdRequestIds.push(request.id);

    const after = await accessRequestsOverTime(30);
    const afterToday = after.find((b) => b.date === todayIso)?.count ?? 0;

    expect(afterToday).toBe(beforeToday + 1);
  });
});

describe("customersByStatus", () => {
  it("returns all five statuses in a stable order with non-negative counts", async () => {
    const slices = await customersByStatus();
    expect(slices.map((s) => s.status)).toEqual([
      "APPROVED",
      "PENDING",
      "REJECTED",
      "EXPIRED",
      "BLOCKED",
    ]);
    for (const slice of slices) {
      expect(slice.count).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("order metrics", () => {
  const createdOrderIds: string[] = [];

  afterEach(async () => {
    if (createdOrderIds.length > 0) {
      await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
      createdOrderIds.length = 0;
    }
  });

  async function seedOrder(data: {
    status: "PLACED" | "FULFILLED" | "CANCELLED";
    subtotalPaise: number;
    items?: unknown;
  }) {
    const customer = await prisma.customer.findFirst({ select: { id: true } });
    const order = await prisma.order.create({
      data: {
        orderNumber: `QA-METRIC-${createdOrderIds.length}-${Date.now()}`,
        customerId: customer!.id,
        status: data.status,
        itemCount: 1,
        subtotalPaise: data.subtotalPaise,
        items: data.items ?? [
          { productId: "x", name: "Metric Widget", quantity: 5 },
        ],
        placedAt: new Date(),
      },
    });
    createdOrderIds.push(order.id);
    return order;
  }

  it("buckets today's orders and their value; CANCELLED is excluded from both", async () => {
    const before = await ordersOverTime(30);
    const todayBefore = before[before.length - 1];

    await seedOrder({ status: "PLACED", subtotalPaise: 10_000 });
    await seedOrder({ status: "CANCELLED", subtotalPaise: 99_999 });

    const after = await ordersOverTime(30);
    const today = after[after.length - 1];
    expect(after).toHaveLength(30);
    expect(today.count).toBe(todayBefore.count + 1);
    expect(today.valuePaise).toBe(todayBefore.valuePaise + 10_000);
  });

  it("breaks orders down by status", async () => {
    const before = await orderStatusBreakdown();
    const placedBefore =
      before.find((s) => s.status === "PLACED")?.count ?? 0;
    await seedOrder({ status: "PLACED", subtotalPaise: 5_000 });
    const after = await orderStatusBreakdown();
    expect(after.find((s) => s.status === "PLACED")?.count).toBe(
      placedBefore + 1,
    );
  });

  it("ranks products by units from frozen snapshots and skips malformed lines", async () => {
    await seedOrder({
      status: "PLACED",
      subtotalPaise: 1_000,
      items: [
        { productId: "a", name: "Units Champ", quantity: 40 },
        { productId: "b", name: "Runner Up", quantity: 15 },
        { productId: "c", quantity: 99 }, // no name — must be skipped
        { productId: "d", name: "Bad Qty", quantity: "lots" }, // must be skipped
      ],
    });
    const top = await topOrderedProducts(8, 30);
    const champ = top.find((p) => p.name === "Units Champ");
    const runner = top.find((p) => p.name === "Runner Up");
    expect(champ).toBeDefined();
    expect(champ!.count).toBeGreaterThanOrEqual(40);
    expect(runner).toBeDefined();
    expect(top.some((p) => p.name === "Bad Qty")).toBe(false);
    expect(top.indexOf(champ!)).toBeLessThan(top.indexOf(runner!));
  });

  it("rejects non-admin viewers on every order metric", async () => {
    viewerMock.current = ANON_VIEWER;
    for (const call of [
      () => ordersOverTime(30),
      () => orderStatusBreakdown(),
      () => topOrderedProducts(),
    ]) {
      await expect(call()).rejects.toSatisfy(isForbiddenError);
    }
  });
});
