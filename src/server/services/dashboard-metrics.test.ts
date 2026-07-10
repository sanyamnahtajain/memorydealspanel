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
