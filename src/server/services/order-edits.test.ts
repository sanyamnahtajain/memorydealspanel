import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { placeOrder } from "@/server/services/orders";
import { parseOrderItems } from "@/server/services/admin-orders";
import {
  applyOrderEdit,
  listOrderRevisions,
  orderVersionOf,
  previewOrderEdit,
  type OrderEditActor,
} from "./order-edits";

/**
 * The order-editing engine against a real MongoDB, end to end: place a real
 * order through the real placement path, then edit it the way the admin
 * console and the storefront will, and check that money, history and
 * concurrency behave.
 */

const customerIds = new Set<string>();
const productIds = new Set<string>();
/** Only notifications this file created are ours to remove. */
const startedAt = new Date();

function uniqueSku(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

async function makeCustomer(): Promise<string> {
  const phone = `+918${String((Date.now() + Math.floor(Math.random() * 1e6)) % 1_000_000_000).padStart(9, "0")}`;
  const customer = await prisma.customer.create({
    data: {
      businessName: "Edit Biz",
      contactName: "Edit Test",
      phone,
      passwordHash: await hashPassword("password1234"),
      status: "APPROVED",
    },
    select: { id: true },
  });
  customerIds.add(customer.id);
  await prisma.accessGrant.create({
    data: { customerId: customer.id, grantedBy: "test", revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  return customer.id;
}

async function makeProduct(opts: { price?: number; moq?: number | null; packMultiple?: number | null } = {}): Promise<string> {
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error("seed missing: no category");
  const sku = uniqueSku("EDT");
  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      name: `Edit Widget ${sku}`,
      slug: `edit-widget-${sku.toLowerCase()}`,
      sku,
      price: opts.price ?? 10_000, // ₹100
      mrp: 12_000,
      moq: opts.moq === undefined ? null : opts.moq,
      packMultiple: opts.packMultiple === undefined ? null : opts.packMultiple,
      stockStatus: "IN_STOCK",
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true },
  });
  productIds.add(product.id);
  return product.id;
}

async function placeFixtureOrder(customerId: string, lines: { productId: string; quantity: number }[]) {
  for (const l of lines) {
    await prisma.cartItem.create({ data: { customerId, productId: l.productId, quantity: l.quantity } });
  }
  const result = await placeOrder(customerId, { idempotencyKey: `edit-${Math.random()}` });
  if (!result.ok) throw new Error(`fixture order failed: ${result.message}`);
  return result.order;
}

const admin: OrderEditActor = { kind: "admin", adminId: "test-admin" };

beforeAll(async () => {
  await prisma.storeSettings.upsert({
    where: { key: "default" },
    create: { key: "default", minOrderValuePaise: null },
    update: { minOrderValuePaise: null },
  });
});

afterEach(async () => {
  const cids = [...customerIds];
  const pids = [...productIds];
  if (cids.length) {
    const orders = await prisma.order.findMany({ where: { customerId: { in: cids } }, select: { id: true } });
    await prisma.orderRevision.deleteMany({ where: { orderId: { in: orders.map((o) => o.id) } } });
    await prisma.order.deleteMany({ where: { customerId: { in: cids } } });
    await prisma.cartItem.deleteMany({ where: { customerId: { in: cids } } });
    await prisma.accessGrant.deleteMany({ where: { customerId: { in: cids } } });
    await prisma.notification.deleteMany({
      where: {
        type: { in: ["order.placed", "order.editedByCustomer"] },
        createdAt: { gte: startedAt },
      },
    });
    await prisma.customer.deleteMany({ where: { id: { in: cids } } });
  }
  if (pids.length) await prisma.product.deleteMany({ where: { id: { in: pids } } });
  customerIds.clear();
  productIds.clear();
});

describe("editing an order", () => {
  it("changing a quantity re-prices at the FROZEN unit price and bumps the version", async () => {
    const customerId = await makeCustomer();
    const productId = await makeProduct({ price: 10_000 });
    const order = await placeFixtureOrder(customerId, [{ productId, quantity: 10 }]);

    // The catalogue price moves AFTER placement — the order must not follow it.
    await prisma.product.update({ where: { id: productId }, data: { price: 99_900 } });

    const preview = await previewOrderEdit(order.id, admin, {
      expectedVersion: 1,
      lines: [{ productId, variantId: null, quantity: 30 }],
    });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.lines[0]!.unitPricePaise).toBe(10_000);
    expect(preview.after.subtotalPaise).toBe(300_000);
    expect(preview.changes).toEqual([expect.objectContaining({ kind: "quantity", from: 10, to: 30 })]);

    const applied = await applyOrderEdit(order.id, admin, {
      expectedVersion: 1,
      lines: [{ productId, variantId: null, quantity: 30 }],
      reason: "Customer called and asked for more",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.version).toBe(2);

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.subtotalPaise).toBe(300_000);
    expect(row.itemCount).toBe(30);
    expect(orderVersionOf(row.version)).toBe(2);
    expect(row.editedAt).not.toBeNull();
    const items = parseOrderItems(row.items);
    expect(items[0]).toMatchObject({ quantity: 30, unitPricePaise: 10_000, lineTotalPaise: 300_000 });

    const history = await listOrderRevisions(order.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      version: 2,
      actorType: "admin",
      actorId: "test-admin",
      reason: "Customer called and asked for more",
    });
    expect(history[0]!.before?.subtotalPaise).toBe(100_000);
    expect(history[0]!.after?.subtotalPaise).toBe(300_000);
  }, 30_000);

  it("removes a line, adds one at TODAY'S price, and reports both", async () => {
    const customerId = await makeCustomer();
    const keep = await makeProduct({ price: 10_000 });
    const drop = await makeProduct({ price: 5_000 });
    const fresh = await makeProduct({ price: 25_000 });
    const order = await placeFixtureOrder(customerId, [
      { productId: keep, quantity: 2 },
      { productId: drop, quantity: 4 },
    ]);

    const applied = await applyOrderEdit(order.id, admin, {
      expectedVersion: 1,
      lines: [
        { productId: keep, variantId: null, quantity: 2 },
        { productId: fresh, variantId: null, quantity: 3 },
      ],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.changes.map((c) => c.kind).sort()).toEqual(["added", "removed"]);
    expect(applied.after.subtotalPaise).toBe(2 * 10_000 + 3 * 25_000);
    expect(applied.after.lineCount).toBe(2);

    const items = parseOrderItems((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).items);
    expect(items.map((i) => i.productId).sort()).toEqual([keep, fresh].sort());
  }, 30_000);

  it("refuses a stale version instead of overwriting — and the second editor sees why", async () => {
    const customerId = await makeCustomer();
    const productId = await makeProduct();
    const order = await placeFixtureOrder(customerId, [{ productId, quantity: 5 }]);

    const first = await applyOrderEdit(order.id, admin, {
      expectedVersion: 1,
      lines: [{ productId, variantId: null, quantity: 6 }],
    });
    expect(first.ok).toBe(true);

    const second = await applyOrderEdit(order.id, admin, {
      expectedVersion: 1, // still looking at the version before `first`
      lines: [{ productId, variantId: null, quantity: 7 }],
    });
    expect(second).toMatchObject({ ok: false, error: "conflict" });

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.itemCount).toBe(6);
    expect(await listOrderRevisions(order.id)).toHaveLength(1);
  }, 30_000);

  it("edits a legacy order that has NO version field at all", async () => {
    const customerId = await makeCustomer();
    const productId = await makeProduct();
    const order = await placeFixtureOrder(customerId, [{ productId, quantity: 5 }]);
    // Strip the field the way a pre-feature document looks on MongoDB.
    await prisma.order.updateMany({ where: { id: order.id }, data: { version: { unset: true } } });
    const raw = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, select: { version: true } });
    expect(raw.version).toBeNull();

    const applied = await applyOrderEdit(order.id, admin, {
      expectedVersion: 1,
      lines: [{ productId, variantId: null, quantity: 8 }],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.version).toBe(2);
  }, 30_000);

  it("a customer may edit only their own PLACED order, inside the product's rules", async () => {
    const customerId = await makeCustomer();
    const other = await makeCustomer();
    const productId = await makeProduct({ moq: 10, packMultiple: 10 });
    const order = await placeFixtureOrder(customerId, [{ productId, quantity: 10 }]);
    const me: OrderEditActor = { kind: "customer", customerId };

    // Someone else's order does not exist as far as this customer knows.
    expect(
      await previewOrderEdit(order.id, { kind: "customer", customerId: other }, {
        expectedVersion: 1,
        lines: [{ productId, variantId: null, quantity: 20 }],
      }),
    ).toMatchObject({ ok: false, error: "not-found" });

    // Off the pack multiple → refused with the rule, never clamped.
    const offRule = await previewOrderEdit(order.id, me, {
      expectedVersion: 1,
      lines: [{ productId, variantId: null, quantity: 15 }],
    });
    expect(offRule).toMatchObject({ ok: false, error: "invalid" });
    if (!offRule.ok) expect(offRule.message).toMatch(/multiples of 10/);

    // On the rule → fine, and recorded as the customer's own change.
    const applied = await applyOrderEdit(order.id, me, {
      expectedVersion: 1,
      lines: [{ productId, variantId: null, quantity: 20 }],
      note: "Please pack in two boxes",
    });
    expect(applied.ok).toBe(true);
    expect((await listOrderRevisions(order.id))[0]).toMatchObject({ actorType: "customer", actorId: customerId });
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.note).toBe("Please pack in two boxes");

    // Once confirmed, the customer's window is shut; staff may still edit.
    await prisma.order.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
    expect(
      await previewOrderEdit(order.id, me, { expectedVersion: 2, lines: [{ productId, variantId: null, quantity: 30 }] }),
    ).toMatchObject({ ok: false, error: "status" });
    expect(
      (await previewOrderEdit(order.id, admin, { expectedVersion: 2, lines: [{ productId, variantId: null, quantity: 30 }] })).ok,
    ).toBe(true);
  }, 30_000);

  it("staff may override the pack rule; nobody may empty an order or repeat a line", async () => {
    const customerId = await makeCustomer();
    const productId = await makeProduct({ moq: 10, packMultiple: 10 });
    const order = await placeFixtureOrder(customerId, [{ productId, quantity: 10 }]);

    const override = await previewOrderEdit(order.id, admin, {
      expectedVersion: 1,
      lines: [{ productId, variantId: null, quantity: 5 }],
    });
    expect(override.ok).toBe(true);
    if (override.ok) expect(override.after.itemCount).toBe(5);

    expect(
      await applyOrderEdit(order.id, admin, {
        expectedVersion: 1,
        lines: [
          { productId, variantId: null, quantity: 5 },
          { productId, variantId: null, quantity: 5 },
        ],
      }),
    ).toMatchObject({ ok: false, error: "invalid" });

    // An edit that changes nothing is not a revision.
    expect(
      await applyOrderEdit(order.id, admin, { expectedVersion: 1, lines: [{ productId, variantId: null, quantity: 10 }] }),
    ).toMatchObject({ ok: false, error: "unchanged" });
  }, 30_000);

  it("a dispatched order is closed to everyone", async () => {
    const customerId = await makeCustomer();
    const productId = await makeProduct();
    const order = await placeFixtureOrder(customerId, [{ productId, quantity: 1 }]);
    await prisma.order.update({ where: { id: order.id }, data: { status: "DISPATCHED" } });
    const result = await applyOrderEdit(order.id, admin, {
      expectedVersion: 1,
      lines: [{ productId, variantId: null, quantity: 2 }],
    });
    expect(result).toMatchObject({ ok: false, error: "status" });
    if (!result.ok) expect(result.message).toMatch(/dispatched/);
  }, 30_000);
});
