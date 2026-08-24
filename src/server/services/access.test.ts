import { afterEach, describe, expect, it } from "vitest";
import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db";
import { defaultInMemoryStore, setPushStore } from "@/server/notify/push";
import {
  approveRequest,
  autoExtendOnOrder,
  blockCustomer,
  computeCustomerPriceAccess,
  expireDueGrants,
  extendGrant,
  rejectRequest,
  requestAccess,
  requestRenewal,
  retractAutoExtension,
  revokeGrant,
  snoozeRequest,
  unsnoozeRequest,
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

describe("autoExtendOnOrder (auto-renew on order)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("adds 30 days when access expires within 30 days", async () => {
    const id = await makeCustomer("autorenew-soon");
    const { grant } = await approveRequest(id, { expiresInDays: 10, grantedBy: ADMIN });
    const before = grant.expiresAt!.getTime();

    const outcome = await autoExtendOnOrder(id);
    expect(outcome.extended).toBe(true);
    if (!outcome.extended) return;
    // Stacked onto the CURRENT expiry (10d left + 30d), never reset to now+30.
    expect(outcome.expiresAt.getTime() - before).toBe(30 * DAY);
    expect(await computeCustomerPriceAccess(id)).toBe(true);

    const stored = await prisma.accessGrant.findFirst({ where: { customerId: id } });
    expect(stored?.expiresAt?.getTime()).toBe(before + 30 * DAY);
  });

  it("extends exactly at the 30-day boundary", async () => {
    const id = await makeCustomer("autorenew-edge");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    const outcome = await autoExtendOnOrder(id);
    expect(outcome.extended).toBe(true);
  });

  it("leaves access alone when more than 30 days remain", async () => {
    const id = await makeCustomer("autorenew-far");
    const { grant } = await approveRequest(id, { expiresInDays: 90, grantedBy: ADMIN });
    const outcome = await autoExtendOnOrder(id);
    expect(outcome).toEqual({ extended: false, reason: "outside-window" });
    const stored = await prisma.accessGrant.findFirst({ where: { customerId: id } });
    expect(stored?.expiresAt?.getTime()).toBe(grant.expiresAt!.getTime());
  });

  it("leaves never-expiring access alone", async () => {
    const id = await makeCustomer("autorenew-forever");
    await approveRequest(id, { expiresInDays: null, grantedBy: ADMIN });
    const outcome = await autoExtendOnOrder(id);
    expect(outcome).toEqual({ extended: false, reason: "never-expires" });
    const stored = await prisma.accessGrant.findFirst({ where: { customerId: id } });
    expect(stored?.expiresAt).toBeNull();
  });

  it("is a no-op for a customer with no live grant (defensive)", async () => {
    const id = await makeCustomer("autorenew-none");
    const outcome = await autoExtendOnOrder(id);
    expect(outcome).toEqual({ extended: false, reason: "no-live-grant" });
    expect(await computeCustomerPriceAccess(id)).toBe(false);
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
        city: "Delhi",
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
      city: "Delhi",
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
        city: "Delhi",
      },
      "t",
      "203.0.113.12",
    );
    expect(result.ok).toBe(false);
  });
});

describe("snoozeRequest / unsnoozeRequest (skip & review later)", () => {
  it("parks a PENDING request, keeps it an OPEN request, and round-trips back", async () => {
    const id = await makeCustomer("snooze");
    const request = await prisma.accessRequest.findFirst({
      where: { customerId: id, status: "PENDING" },
      select: { id: true },
    });
    expect(request).not.toBeNull();

    expect(await snoozeRequest(request!.id)).toEqual({ ok: true });
    // Snoozing twice is a no-op (only PENDING can snooze).
    expect(await snoozeRequest(request!.id)).toEqual({ ok: false, error: "NOT_FOUND" });
    // The customer's own status is untouched (still pending review for them).
    const customer = await prisma.customer.findUnique({ where: { id }, select: { status: true } });
    expect(customer?.status).toBe("PENDING");

    // A repeat sign-up while snoozed does NOT open a duplicate request.
    const dupe = await requestAccess(
      {
        businessName: "Snooze Traders",
        contactName: "S Test",
        phone: (await prisma.customer.findUnique({ where: { id }, select: { phone: true } }))!.phone,
        password: "password1234",
        city: "Jaipur",
      },
      "t",
      "203.0.113.44",
    );
    expect(dupe.ok).toBe(true);
    if (dupe.ok) expect(dupe.duplicate).toBe(true);
    expect(
      await prisma.accessRequest.count({ where: { customerId: id } }),
    ).toBe(1);

    // Back to the queue.
    expect(await unsnoozeRequest(request!.id)).toEqual({ ok: true });
    const row = await prisma.accessRequest.findUnique({
      where: { id: request!.id },
      select: { status: true },
    });
    expect(row?.status).toBe("PENDING");
  });

  it("approve resolves a SNOOZED request too (no orphaned open rows)", async () => {
    const id = await makeCustomer("snooze-approve");
    const request = await prisma.accessRequest.findFirst({
      where: { customerId: id, status: "PENDING" },
      select: { id: true },
    });
    await snoozeRequest(request!.id);

    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    const row = await prisma.accessRequest.findUnique({
      where: { id: request!.id },
      select: { status: true },
    });
    expect(row?.status).toBe("APPROVED");
  });
});

describe("request-access rate limiting (CGNAT-safe)", () => {
  it("distinct customers behind ONE shared IP are not blocked by each other", async () => {
    const sharedIp = "203.0.113.99";
    // 4 different phones from the same IP — under the old per-IP 3/hour
    // budget the 4th stranger was refused; identity keying fixes that.
    for (let i = 0; i < 4; i++) {
      const phone = `+9198${String((Date.now() + i * 7919) % 1_00_00_00_00).padStart(8, "0")}`;
      const res = await requestAccess(
        {
          businessName: `CGNAT Biz ${i}`,
          contactName: `C ${i}`,
          phone,
          password: "password1234",
          city: "Delhi",
        },
        "t",
        sharedIp,
      );
      expect(res.ok, `stranger ${i} behind the shared IP should pass`).toBe(true);
      if (res.ok) created.push(res.customerId);
    }
  });
});

describe("requestRenewal (signed-in, one tap — no form)", () => {
  it("EXPIRED customer: files a renewal-flagged PENDING request + notification, touching NOTHING else", async () => {
    const id = await makeCustomer("renew-expired");
    await approveRequest(id, { expiresInDays: 30, grantedBy: ADMIN });
    // Lapse the grant + status, as the cron would.
    await prisma.accessGrant.updateMany({
      where: { customerId: id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.customer.update({ where: { id }, data: { status: "EXPIRED" } });
    const before = await prisma.customer.findUnique({ where: { id } });

    const result = await requestRenewal(id);
    expect(result).toEqual({ ok: true, duplicate: false });

    const request = await prisma.accessRequest.findFirst({
      where: { customerId: id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    expect(request?.renewal).toBe(true);

    // The identity is untouched: status, password, everything stays.
    const after = await prisma.customer.findUnique({ where: { id } });
    expect(after?.status).toBe("EXPIRED");
    expect(after?.passwordHash).toBe(before?.passwordHash);
    expect(after?.businessName).toBe(before?.businessName);

    // The admin got ringed.
    const notif = await prisma.notification.findFirst({
      where: { type: "renewal_request" },
      orderBy: { createdAt: "desc" },
    });
    expect(notif).not.toBeNull();
    await prisma.notification.deleteMany({ where: { type: "renewal_request" } });
  });

  it("is idempotent: a second tap reports duplicate without a second request", async () => {
    const id = await makeCustomer("renew-dupe");
    await approveRequest(id, { expiresInDays: 1, grantedBy: ADMIN });
    await prisma.accessGrant.updateMany({
      where: { customerId: id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await prisma.customer.update({ where: { id }, data: { status: "EXPIRED" } });

    expect(await requestRenewal(id)).toEqual({ ok: true, duplicate: false });
    expect(await requestRenewal(id)).toEqual({ ok: true, duplicate: true });
    const open = await prisma.accessRequest.count({
      where: { customerId: id, status: "PENDING" },
    });
    expect(open).toBe(1);
    await prisma.notification.deleteMany({ where: { type: "renewal_request" } });
  });

  it("refuses while access is still live, and for blocked accounts", async () => {
    const live = await makeCustomer("renew-live");
    await approveRequest(live, { expiresInDays: 30, grantedBy: ADMIN });
    expect(await requestRenewal(live)).toEqual({ ok: false, reason: "ACTIVE" });

    const blocked = await makeCustomer("renew-blocked");
    await blockCustomer(blocked);
    expect(await requestRenewal(blocked)).toEqual({ ok: false, reason: "BLOCKED" });
  });
});

describe("retractAutoExtension (cancel-order rollback — anti-abuse)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("takes the granted days back off the live grant", async () => {
    const id = await makeCustomer("retract");
    const { grant } = await approveRequest(id, { expiresInDays: 10, grantedBy: ADMIN });
    const original = grant.expiresAt!.getTime();
    const outcome = await autoExtendOnOrder(id); // +30
    expect(outcome.extended).toBe(true);

    const result = await retractAutoExtension(id, 30);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Back to exactly where they were before the junk order.
    expect(result.expiresAt?.getTime()).toBe(original);
    expect(await computeCustomerPriceAccess(id)).toBe(true);
  });

  it("a rollback landing in the past ends access immediately (EXPIRED)", async () => {
    const id = await makeCustomer("retract-past");
    await approveRequest(id, { expiresInDays: 5, grantedBy: ADMIN });

    const result = await retractAutoExtension(id, 30);
    expect(result.ok).toBe(true);
    expect(await computeCustomerPriceAccess(id)).toBe(false);
    const customer = await prisma.customer.findUnique({ where: { id } });
    expect(customer?.status).toBe("EXPIRED");
  });

  it("never touches an unlimited grant", async () => {
    const id = await makeCustomer("retract-forever");
    await approveRequest(id, { expiresInDays: null, grantedBy: ADMIN });
    expect(await retractAutoExtension(id, 30)).toEqual({
      ok: false,
      reason: "NO_FINITE_GRANT",
    });
    expect(await computeCustomerPriceAccess(id)).toBe(true);
  });
});
