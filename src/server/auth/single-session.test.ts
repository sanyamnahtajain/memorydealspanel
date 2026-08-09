import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";

/**
 * Single-active-session invariant: creating a session for a principal revokes
 * every other live session for that same principal (newest login wins), while
 * other principals' sessions are untouched.
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

afterEach(async () => {
  if (createdCustomerIds.length === 0) return;
  await prisma.session.deleteMany({
    where: { customerId: { in: createdCustomerIds } },
  });
  await prisma.customer.deleteMany({
    where: { id: { in: createdCustomerIds } },
  });
  createdCustomerIds.length = 0;
});

async function liveSessionCount(customerId: string): Promise<number> {
  return prisma.session.count({
    where: {
      customerId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
}

describe("single active session", () => {
  it("a second login revokes the first session", async () => {
    const customerId = await makeCustomer("A");

    await createSession({ kind: "customer", customerId });
    expect(await liveSessionCount(customerId)).toBe(1);

    await createSession({ kind: "customer", customerId });
    expect(await liveSessionCount(customerId)).toBe(1);

    // The older session still exists, but revoked (audit trail preserved).
    const total = await prisma.session.count({ where: { customerId } });
    expect(total).toBe(2);
    const revoked = await prisma.session.count({
      where: { customerId, revokedAt: { not: null } },
    });
    expect(revoked).toBe(1);
  });

  it("does not touch other principals' sessions", async () => {
    const a = await makeCustomer("A");
    const b = await makeCustomer("B");

    await createSession({ kind: "customer", customerId: a });
    await createSession({ kind: "customer", customerId: b });

    expect(await liveSessionCount(a)).toBe(1);
    expect(await liveSessionCount(b)).toBe(1);
  });
});
