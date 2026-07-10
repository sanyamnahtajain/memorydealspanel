import { afterEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db";
import { defaultInMemoryStore, setPushStore } from "@/server/notify/push";
import {
  approveRequest,
  blockCustomer,
  computeCustomerPriceAccess,
  expireDueGrants,
  extendGrant,
  rejectRequest,
  requestAccess,
  revokeGrant,
  unblockCustomer,
} from "./access";

/**
 * Integration tests for the access-lifecycle state machine against the SEEDED
 * local MongoDB.
 *
 * The single invariant under test is the price-access gate: a customer may see
 * prices ONLY when their status is APPROVED AND they hold a live (unrevoked,
 * unexpired) AccessGrant. `computeCustomerPriceAccess` mirrors exactly what
 * `resolveViewer` computes, so asserting it after each transition proves the
 * gate flips correctly end-to-end without spinning up a session/cookie.
 *
 * Every test creates its own throwaway customer(s) and deletes them (plus their
 * grants / requests) afterwards so the seed set is left untouched and re-runs
 * are deterministic.
 */

// Keep push notifications out of the DB and off the network during tests.
setPushStore(defaultInMemoryStore);

const ADMIN = "test-admin";
const created: string[] = [];

/** Create a bare PENDING customer with a fresh unique phone; tracked for cleanup. */
async function makeCustomer(seed: string): Promise<string> {
  const passwordHash = await hashPassword("password1234");
  // A valid Indian mobile: 9 + 9 more digits, unique per test via timestamp.
  const phone = `+919${String(Date.now() % 1_000_000_000).padStart(9, "0")}`;
  const customer = await prisma.customer.create({
    data: {
      businessName: `Test Biz ${seed}`,
      contactName: `Contact ${seed}`,
      phone,
      passwordHash,
      status: "PENDING",
      requests: { create: { status: "PENDING" } },
    },
    select: { id: true },
  });
  created.push(customer.id);
  return customer.id;
}

afterEach(async () => {
  if (created.length === 0) return;
  const ids = [...created];
  created.length = 0;
  // Grants / requests cascade on Customer delete, but delete explicitly to be
  // safe across engines and to remove any rows we created directly.
  await prisma.accessGrant.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.accessRequest.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.session.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } });
});

describe("approveRequest", () => {
  it("flips priceAccess to true and marks the request APPROVED", async () => {
    const id = await makeCustomer("approve");
    expect(await computeCustomerPriceAccess(id)).toBe(false);

    const { customer, grant } = await approveRequest(id, {
      expiresInDays: 30,
      grantedBy: ADMIN,
    });

    expect(customer.status).toBe("APPROVED");
    expect(grant.expiresAt).not.toBeNull();
    expect(await computeCustomerPriceAccess(id)).toBe(true);

    const req = await prisma.accessRequest.findFirst({ where: { customerId: id } });
    expect(req?.status).toBe("APPROVED");
    expect(req?.decidedAt).not.toBeNull();
  });

  it("supports an unlimited (never-expiring) grant", async () => {
    const id = await makeCustomer("approve-forever");
    const { grant } = await approveRequest(id, {
      expiresInDays: null,
      grantedBy: ADMIN,
    });
    expect(grant.expiresAt).toBeNull();
    expect(await computeCustomerPriceAccess(id)).toBe(true);
  });
});

describe("expireDueGrants / expiry", () => {
  it("flips priceAccess to false once the grant has lapsed", async () => {
    const id = await makeCustomer("expire");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    expect(await computeCustomerPriceAccess(id)).toBe(true);

    // Backdate the grant's expiry into the past.
    await prisma.accessGrant.updateMany({
      where: { customerId: id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    // Even before the cron runs, the computed gate is already closed.
    expect(await computeCustomerPriceAccess(id)).toBe(false);

    const result = await expireDueGrants(new Date());
    expect(result.customerIds).toContain(id);

    const customer = await prisma.customer.findUnique({ where: { id } });
    expect(customer?.status).toBe("EXPIRED");
    expect(await computeCustomerPriceAccess(id)).toBe(false);
  });

  it("does not expire a customer who still holds a live grant", async () => {
    const id = await makeCustomer("expire-live");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });

    const result = await expireDueGrants(new Date());
    expect(result.customerIds).not.toContain(id);
    expect(await computeCustomerPriceAccess(id)).toBe(true);
  });
});

describe("rejectRequest", () => {
  it("denies price access and records the reason", async () => {
    const id = await makeCustomer("reject");
    const customer = await rejectRequest(id, "Not a wholesale buyer");

    expect(customer.status).toBe("REJECTED");
    expect(await computeCustomerPriceAccess(id)).toBe(false);

    const req = await prisma.accessRequest.findFirst({ where: { customerId: id } });
    expect(req?.status).toBe("REJECTED");
    expect(req?.reason).toBe("Not a wholesale buyer");
  });
});

describe("blockCustomer / unblockCustomer", () => {
  it("block revokes a live grant and denies price access", async () => {
    const id = await makeCustomer("block");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    expect(await computeCustomerPriceAccess(id)).toBe(true);

    const blocked = await blockCustomer(id);
    expect(blocked.status).toBe("BLOCKED");
    expect(await computeCustomerPriceAccess(id)).toBe(false);

    const liveGrants = await prisma.accessGrant.count({
      where: { customerId: id, revokedAt: null },
    });
    expect(liveGrants).toBe(0);
  });

  it("unblock does not silently restore price access", async () => {
    const id = await makeCustomer("unblock");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    await blockCustomer(id);

    const unblocked = await unblockCustomer(id);
    expect(unblocked.status).toBe("REJECTED");
    expect(await computeCustomerPriceAccess(id)).toBe(false);
  });
});

describe("revokeGrant", () => {
  it("revokes grants, sets EXPIRED, and denies price access", async () => {
    const id = await makeCustomer("revoke");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    expect(await computeCustomerPriceAccess(id)).toBe(true);

    const customer = await revokeGrant(id);
    expect(customer.status).toBe("EXPIRED");
    expect(await computeCustomerPriceAccess(id)).toBe(false);

    const grant = await prisma.accessGrant.findFirst({ where: { customerId: id } });
    expect(grant?.revokedAt).not.toBeNull();
  });

  it("revokes all live sessions so access is cut immediately", async () => {
    const id = await makeCustomer("revoke-session");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    // Give the customer a live session, then revoke.
    await prisma.session.create({
      data: {
        tokenHash: `test-${id}-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3_600_000),
        customerId: id,
      },
    });

    await revokeGrant(id);

    const liveSessions = await prisma.session.count({
      where: { customerId: id, revokedAt: null },
    });
    expect(liveSessions).toBe(0);
  });
});

describe("extendGrant / renew", () => {
  it("renews a lapsed customer back to price access", async () => {
    const id = await makeCustomer("renew");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    await revokeGrant(id); // now EXPIRED, no live grant
    expect(await computeCustomerPriceAccess(id)).toBe(false);

    await extendGrant(id, 30, ADMIN);
    expect(await computeCustomerPriceAccess(id)).toBe(true);

    const customer = await prisma.customer.findUnique({ where: { id } });
    expect(customer?.status).toBe("APPROVED");
  });

  it("pushes out an existing live grant's expiry", async () => {
    const id = await makeCustomer("extend");
    await approveRequest(id, { expiresInDays: 7, grantedBy: ADMIN });
    const before = await prisma.accessGrant.findFirst({
      where: { customerId: id, revokedAt: null },
    });

    await extendGrant(id, 30, ADMIN);

    const after = await prisma.accessGrant.findFirst({
      where: { customerId: id, revokedAt: null },
    });
    expect(after?.id).toBe(before?.id); // same grant, extended in place
    expect(after!.expiresAt!.getTime()).toBeGreaterThan(
      before!.expiresAt!.getTime(),
    );
    expect(await computeCustomerPriceAccess(id)).toBe(true);
  });
});

describe("requestAccess (public entry point)", () => {
  it("creates a PENDING customer + request and grants no price access", async () => {
    const phone = `+918${String(Date.now() % 1_000_000_000).padStart(9, "0")}`;
    const result = await requestAccess(
      {
        businessName: "Fresh Buyer Pvt Ltd",
        contactName: "Ravi Kumar",
        phone,
        password: "password1234",
        gstNumber: undefined,
        email: undefined,
        city: undefined,
      },
      "test-token",
      "203.0.113.10",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    created.push(result.customerId);

    expect(result.status).toBe("PENDING");
    expect(result.duplicate).toBe(false);
    expect(await computeCustomerPriceAccess(result.customerId)).toBe(false);

    const req = await prisma.accessRequest.findFirst({
      where: { customerId: result.customerId },
    });
    expect(req?.status).toBe("PENDING");

    const notif = await prisma.notification.findFirst({
      where: { type: "access_request" },
      orderBy: { createdAt: "desc" },
    });
    expect(notif).not.toBeNull();
  });

  it("dedupes a repeat request from an already-pending phone", async () => {
    const phone = `+917${String(Date.now() % 1_000_000_000).padStart(9, "0")}`;
    const form = {
      businessName: "Dedupe Traders",
      contactName: "Asha",
      phone,
      password: "password1234",
      gstNumber: undefined,
      email: undefined,
      city: undefined,
    };

    const first = await requestAccess(form, "t", "203.0.113.11");
    expect(first.ok).toBe(true);
    if (first.ok) created.push(first.customerId);

    const second = await requestAccess(form, "t", "203.0.113.11");
    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;

    // Same customer, flagged as a duplicate, and no second PENDING request row.
    expect(second.customerId).toBe(first.customerId);
    expect(second.duplicate).toBe(true);

    const pendingCount = await prisma.accessRequest.count({
      where: { customerId: first.customerId, status: "PENDING" },
    });
    expect(pendingCount).toBe(1);
  });

  it("refuses a phone that is already approved", async () => {
    const id = await makeCustomer("already-approved");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id } });

    const result = await requestAccess(
      {
        businessName: "Repeat Co",
        contactName: "Dev",
        phone: customer.phone,
        password: "password1234",
        gstNumber: undefined,
        email: undefined,
        city: undefined,
      },
      "t",
      "203.0.113.12",
    );
    expect(result.ok).toBe(false);
  });
});
