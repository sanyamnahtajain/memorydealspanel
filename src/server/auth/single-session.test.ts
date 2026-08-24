import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";

/**
 * Session-concurrency contract (owner request — "customers keep getting
 * logged out"):
 *
 *  - CUSTOMERS may hold several live sessions at once (phone PWA + browser +
 *    shop desktop), capped at MAX_CUSTOMER_SESSIONS = 5; logins beyond the cap
 *    revoke the LEAST recently used session, never the newest.
 *  - ADMINS stay strictly single-session (newest login wins).
 *
 * `next/headers` is mocked with a no-op cookie jar — these tests exercise the
 * DB side of createSession only.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: () => undefined,
    delete: () => undefined,
  }),
}));

const { createSession } = await import("./session");

const createdCustomerIds: string[] = [];
const createdAdminIds: string[] = [];

async function makeCustomer(tag: string): Promise<string> {
  const customer = await prisma.customer.create({
    data: {
      businessName: `SingleSession ${tag}`,
      contactName: "Session Test",
      phone: `+9188${String(
        (Date.now() + Math.floor(Math.random() * 1e7)) % 1_00_00_00_000,
      ).padStart(10, "0")}`,
      passwordHash: "x".repeat(60),
      status: "APPROVED",
    },
    select: { id: true },
  });
  createdCustomerIds.push(customer.id);
  return customer.id;
}

async function makeAdmin(tag: string): Promise<string> {
  const admin = await prisma.admin.create({
    data: {
      name: `SessionAdmin ${tag}`,
      email: `session-admin-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`,
      passwordHash: "x".repeat(60),
      isActive: true,
    },
    select: { id: true },
  });
  createdAdminIds.push(admin.id);
  return admin.id;
}

afterEach(async () => {
  if (createdCustomerIds.length > 0) {
    await prisma.session.deleteMany({
      where: { customerId: { in: createdCustomerIds } },
    });
    await prisma.customer.deleteMany({
      where: { id: { in: createdCustomerIds } },
    });
    createdCustomerIds.length = 0;
  }
  if (createdAdminIds.length > 0) {
    await prisma.session.deleteMany({
      where: { adminId: { in: createdAdminIds } },
    });
    await prisma.admin.deleteMany({ where: { id: { in: createdAdminIds } } });
    createdAdminIds.length = 0;
  }
});

async function liveCustomerSessions(customerId: string): Promise<number> {
  return prisma.session.count({
    where: { customerId, revokedAt: null, expiresAt: { gt: new Date() } },
  });
}

describe("customer sessions — multi-device with an LRU cap", () => {
  it("a second login KEEPS the first session live (phone + browser coexist)", async () => {
    const customerId = await makeCustomer("A");

    await createSession({ kind: "customer", customerId });
    await createSession({ kind: "customer", customerId });

    // Both devices stay signed in — the old single-session revoke was the
    // top cause of the "frequently logged out" complaint.
    expect(await liveCustomerSessions(customerId)).toBe(2);
  });

  it("the 6th login revokes only the least-recently-used session", async () => {
    const customerId = await makeCustomer("B");

    for (let i = 0; i < 6; i++) {
      await createSession({ kind: "customer", customerId });
    }

    expect(await liveCustomerSessions(customerId)).toBe(5);
    // The revoked one is the OLDEST (audit row kept, soft-revoked).
    const revoked = await prisma.session.findMany({
      where: { customerId, revokedAt: { not: null } },
      select: { createdAt: true },
    });
    expect(revoked).toHaveLength(1);
    const all = await prisma.session.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
      select: { revokedAt: true },
    });
    expect(all[0]?.revokedAt).not.toBeNull();
  });

  it("does not touch other principals' sessions", async () => {
    const a = await makeCustomer("A");
    const b = await makeCustomer("B");

    await createSession({ kind: "customer", customerId: a });
    await createSession({ kind: "customer", customerId: b });

    expect(await liveCustomerSessions(a)).toBe(1);
    expect(await liveCustomerSessions(b)).toBe(1);
  });
});

describe("admin sessions — strictly single-active", () => {
  it("a second admin login revokes the first", async () => {
    const adminId = await makeAdmin("A");

    await createSession({ kind: "admin", adminId });
    await createSession({ kind: "admin", adminId });

    const live = await prisma.session.count({
      where: { adminId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    expect(live).toBe(1);
    const total = await prisma.session.count({ where: { adminId } });
    expect(total).toBe(2);
  });
});
