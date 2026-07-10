import { randomBytes, createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomerStatus } from "@prisma/client";
import { prisma } from "@/server/db";

/**
 * priceAccess integration tests against the SEEDED dev database.
 *
 * We mock `next/headers` so resolveViewer/getSession read a token we control,
 * insert a real Session row per case, and assert the recomputed priceAccess.
 *
 * Seed fixtures (see prisma/seed.ts):
 *   APPROVED  9876543210 — grant +60d, not revoked  → priceAccess TRUE
 *   EXPIRED   9850012345 — grant -12d (past)         → priceAccess FALSE
 *   PENDING   9820098200 — no grant                  → priceAccess FALSE
 *   BLOCKED   9702233445 — grant present but revoked → priceAccess FALSE
 *   REJECTED  9765432109 — no grant                  → priceAccess FALSE
 */

let currentToken: string | undefined;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "md_session" && currentToken
        ? { name, value: currentToken }
        : undefined,
  }),
}));

// Import AFTER the mock is registered.
const { resolveViewer } = await import("./viewer");

const SESSION_COOKIE = "md_session";
const createdSessionIds: string[] = [];

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Insert a live session for a customer and point the cookie mock at it. */
async function loginAs(customerId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      customerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  createdSessionIds.push(session.id);
  currentToken = token;
}

async function customerIdByStatus(status: CustomerStatus): Promise<string> {
  const c = await prisma.customer.findFirst({ where: { status } });
  if (!c) throw new Error(`no seeded customer with status ${status}`);
  return c.id;
}

afterEach(async () => {
  currentToken = undefined;
  if (createdSessionIds.length) {
    await prisma.session.deleteMany({
      where: { id: { in: createdSessionIds.splice(0) } },
    });
  }
});

describe("resolveViewer priceAccess", () => {
  it("APPROVED customer with an unexpired grant has priceAccess = true", async () => {
    await loginAs(await customerIdByStatus("APPROVED"));
    const viewer = await resolveViewer();
    expect(viewer.kind).toBe("customer");
    if (viewer.kind !== "customer") throw new Error("expected customer");
    expect(viewer.status).toBe("APPROVED");
    expect(viewer.priceAccess).toBe(true);
  });

  it("EXPIRED customer (grant in the past) has priceAccess = false", async () => {
    await loginAs(await customerIdByStatus("EXPIRED"));
    const viewer = await resolveViewer();
    if (viewer.kind !== "customer") throw new Error("expected customer");
    expect(viewer.priceAccess).toBe(false);
  });

  it("PENDING customer (no grant) has priceAccess = false", async () => {
    await loginAs(await customerIdByStatus("PENDING"));
    const viewer = await resolveViewer();
    if (viewer.kind !== "customer") throw new Error("expected customer");
    expect(viewer.priceAccess).toBe(false);
  });

  it("BLOCKED customer (grant revoked) has priceAccess = false", async () => {
    await loginAs(await customerIdByStatus("BLOCKED"));
    const viewer = await resolveViewer();
    if (viewer.kind !== "customer") throw new Error("expected customer");
    expect(viewer.priceAccess).toBe(false);
  });

  it("REJECTED customer (no grant) has priceAccess = false", async () => {
    await loginAs(await customerIdByStatus("REJECTED"));
    const viewer = await resolveViewer();
    if (viewer.kind !== "customer") throw new Error("expected customer");
    expect(viewer.priceAccess).toBe(false);
  });

  it("no cookie resolves to the anon viewer", async () => {
    currentToken = undefined;
    const viewer = await resolveViewer();
    expect(viewer.kind).toBe("anon");
  });

  it("an expired session row resolves to anon", async () => {
    const customerId = await customerIdByStatus("APPROVED");
    const token = randomBytes(32).toString("hex");
    const session = await prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        customerId,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    createdSessionIds.push(session.id);
    currentToken = token;
    const viewer = await resolveViewer();
    expect(viewer.kind).toBe("anon");
  });
});

// Keep SESSION_COOKIE referenced so the test documents the cookie name.
void SESSION_COOKIE;
