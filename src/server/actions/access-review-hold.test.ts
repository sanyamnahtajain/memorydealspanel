import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerContext } from "@/server/types/viewer";

const viewerMock = vi.hoisted(() => ({ current: null as ViewerContext | null }));

vi.mock("@/server/auth/viewer", () => ({
  resolveViewer: vi.fn(async () => {
    if (!viewerMock.current) throw new Error("no viewer set in test");
    return viewerMock.current;
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { hashPassword } from "@/server/auth/password";
import { prisma } from "@/server/db";
import { defaultInMemoryStore, setPushStore } from "@/server/notify/push";
import { getAccessReviews } from "@/server/services/access-review";
import {
  approveAccessAction,
  bulkApproveAccessAction,
  bulkExtendAccessAction,
  extendAccessAction,
} from "./access";

/**
 * The approval review end to end against the local MongoDB: the batched
 * history is right, and the SERVER refuses to re-approve a shop that was
 * approved again and again without ever ordering — unless the admin types why.
 */

setPushStore(defaultInMemoryStore);

const DAY = 86_400_000;
const customers: string[] = [];
const orders: string[] = [];
let adminId = "";

beforeEach(async () => {
  if (!adminId) {
    const admin = await prisma.admin.findFirst({ select: { id: true } });
    adminId = admin!.id;
  }
  viewerMock.current = { kind: "admin", adminId, name: "QA", roleId: null, permissions: ["*"] };
});

afterEach(async () => {
  const ids = customers.splice(0);
  await prisma.order.deleteMany({ where: { id: { in: orders.splice(0) } } });
  await prisma.pageView.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.accessGrant.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.accessRequest.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entity: "Customer", entityId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } });
});

let seq = 0;
async function makeCustomer(): Promise<string> {
  seq += 1;
  const phone = `+918${String((Date.now() + seq) % 1_000_000_000).padStart(9, "0")}`;
  const c = await prisma.customer.create({
    data: {
      businessName: `Review QA ${seq}`,
      contactName: "QA",
      phone,
      passwordHash: await hashPassword("password1234"),
      status: "EXPIRED",
      requests: { create: { status: "PENDING", renewal: true } },
    },
    select: { id: true },
  });
  customers.push(c.id);
  return c.id;
}

/** A lapsed admin approval `daysAgo` days back (30-day grant). */
async function pastApproval(customerId: string, daysAgo: number, grantedBy = "admin-x") {
  const approvedAt = new Date(Date.now() - daysAgo * DAY);
  await prisma.accessGrant.create({
    data: {
      customerId,
      approvedAt,
      expiresAt: new Date(approvedAt.getTime() + 30 * DAY),
      revokedAt: null,
      grantedBy,
    },
  });
}

async function order(customerId: string, daysAgo: number, status: "PLACED" | "CANCELLED" = "PLACED") {
  const o = await prisma.order.create({
    data: {
      orderNumber: `QA-REV-${Date.now()}-${orders.length}-${seq}`,
      customerId,
      status,
      itemCount: 1,
      subtotalPaise: 1000,
      items: [],
      placedAt: new Date(Date.now() - daysAgo * DAY),
    },
  });
  orders.push(o.id);
}

const expiry = { presetDays: 30 } as const;

describe("getAccessReviews (batched history)", () => {
  it("counts approvals after the last real order, ignoring cancelled orders and system renewals", async () => {
    const regular = await makeCustomer();
    await pastApproval(regular, 90);
    await order(regular, 70);
    await order(regular, 10);

    const freeloader = await makeCustomer();
    await pastApproval(freeloader, 100);
    await order(freeloader, 95); // ordered once, long ago
    await pastApproval(freeloader, 70);
    await pastApproval(freeloader, 35);
    await order(freeloader, 20, "CANCELLED"); // a cancelled order is not an order
    await pastApproval(freeloader, 60, "system:auto-renew-on-order"); // not an admin decision
    const product = await prisma.product.findFirst({ select: { id: true } });
    await prisma.pageView.createMany({
      data: [1, 2, 3].map(() => ({ customerId: freeloader, productId: product!.id })),
    });

    const brandNew = await makeCustomer();

    const reviews = await getAccessReviews([regular, freeloader, brandNew]);

    expect(reviews.get(regular)!.level).toBe("good");
    expect(reviews.get(regular)!.history).toMatchObject({
      ordersTotal: 2,
      ordersRecent: 1,
      approvalsTotal: 1,
      approvalsSinceLastOrder: 0,
    });

    const f = reviews.get(freeloader)!;
    expect(f.level).toBe("hold");
    expect(f.history).toMatchObject({
      ordersTotal: 1,
      cancelledTotal: 1,
      approvalsTotal: 3,
      approvalsSinceLastOrder: 2,
      viewsRecent: 3,
    });

    expect(reviews.get(brandNew)!.level).toBe("new");
  });

  it("answers for an empty list without touching the database", async () => {
    expect((await getAccessReviews([])).size).toBe(0);
  });
});

describe("approveAccessAction — the hold is enforced on the server", () => {
  it("refuses a shop approved twice with no order, with a clear message", async () => {
    const id = await makeCustomer();
    await pastApproval(id, 80);
    await pastApproval(id, 40);

    const res = await approveAccessAction({ customerId: id, expiry });
    expect(res).toMatchObject({ ok: false, code: "ACCESS_HOLD" });
    if (!res.ok) expect(res.error).toMatch(/never placed an order.*reason/);
    expect(await prisma.accessGrant.count({ where: { customerId: id } })).toBe(2);
  });

  it("rejects a too-short reason, then approves with a real one and audits it", async () => {
    const id = await makeCustomer();
    await pastApproval(id, 80);
    await pastApproval(id, 40);

    const short = await approveAccessAction({ customerId: id, expiry, override: { reason: "ok" } });
    expect(short.ok).toBe(false);

    const res = await approveAccessAction({
      customerId: id,
      expiry,
      override: { reason: "Called him, order coming Monday" },
    });
    expect(res.ok).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "access.approve", entityId: id },
      orderBy: { createdAt: "desc" },
    });
    expect(audit?.diff).toMatchObject({
      review: "hold",
      approvalsSinceLastOrder: 2,
      overrideReason: "Called him, order coming Monday",
    });
  });

  it("lets a 'watch' shop (approved once, no order) through — the screen warns, the server does not block", async () => {
    const id = await makeCustomer();
    await pastApproval(id, 40);
    const res = await approveAccessAction({ customerId: id, expiry });
    expect(res.ok).toBe(true);
  });
});

describe("extendAccessAction", () => {
  it("never holds a SHORTENING of live access", async () => {
    const id = await makeCustomer();
    await pastApproval(id, 80);
    await pastApproval(id, 50);
    // live grant (approved today, 30 days) — third approval, still no order
    await prisma.accessGrant.create({
      data: { customerId: id, approvedAt: new Date(), expiresAt: new Date(Date.now() + 30 * DAY), revokedAt: null, grantedBy: "admin-x" },
    });
    await prisma.customer.update({ where: { id }, data: { status: "APPROVED" } });

    const shorter = await extendAccessAction({
      customerId: id,
      expiry: { expiresAt: new Date(Date.now() + 5 * DAY).toISOString() },
    });
    expect(shorter.ok).toBe(true);

    const longer = await extendAccessAction({
      customerId: id,
      expiry: { expiresAt: new Date(Date.now() + 60 * DAY).toISOString() },
    });
    expect(longer).toMatchObject({ ok: false, code: "ACCESS_HOLD" });
  });
});

describe("bulk bars skip held shops and say so", () => {
  it("approves the rest and returns the held ones as failed", async () => {
    const fine = await makeCustomer();
    const held = await makeCustomer();
    await pastApproval(held, 80);
    await pastApproval(held, 40);

    const res = await bulkApproveAccessAction({ customerIds: [fine, held], expiry });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.count).toBe(1);
    expect(res.failed).toEqual([{ id: held, error: expect.stringMatching(/^Held — /) }]);
    expect(await prisma.accessGrant.count({ where: { customerId: fine } })).toBe(1);
    expect(await prisma.accessGrant.count({ where: { customerId: held } })).toBe(2);
  });

  it("a bulk extend where everyone is held writes nothing", async () => {
    const held = await makeCustomer();
    await pastApproval(held, 80);
    await pastApproval(held, 40);
    const res = await bulkExtendAccessAction({ customerIds: [held], expiry });
    expect(res).toMatchObject({ ok: true, count: 0 });
    expect(await prisma.accessGrant.count({ where: { customerId: held } })).toBe(2);
  });
});
