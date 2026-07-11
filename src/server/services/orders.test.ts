import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import {
  placeOrder,
  priceCartForCustomer,
  getOrderForCustomer,
  assertCanOrder,
  OrderAccessError,
} from "./orders";

/**
 * Integration tests for the orders anti-cheat heart, run against the SEEDED
 * local MongoDB (same style as wishlist.test.ts). They prove the invariants
 * that are the whole point of this phase:
 *
 *   - PRICE IS SERVER-AUTHORITATIVE: a cart carries NO price; the order total is
 *     computed from the live product row. We prove a bogus price can't be
 *     injected because there is nowhere in the pipeline to inject it — the order
 *     total equals price*qty of the SERVER row, not anything the caller passes.
 *   - EMPTY CART is rejected.
 *   - EXPIRED / non-approved customer cannot place (grant re-checked at
 *     placement, even though the cart was built while approved).
 *   - IDOR: an order is only visible to its owner.
 *
 * Everything created is tracked and hard-deleted in afterEach so the seed set
 * stays pristine (orders/cart cascade on customer delete).
 */

const customerIds = new Set<string>();
const productIds = new Set<string>();

async function seedCategoryId(): Promise<string> {
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error("seed missing: no category");
  return category.id;
}

function uniqueSku(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`.toUpperCase();
}

async function makeCustomer(): Promise<string> {
  const passwordHash = await hashPassword("password1234");
  const phone = `+919${String(
    (Date.now() + Math.floor(Math.random() * 1e6)) % 1_000_000_000,
  ).padStart(9, "0")}`;
  const customer = await prisma.customer.create({
    data: {
      businessName: "Orders Biz",
      contactName: "Orders Test",
      phone,
      passwordHash,
      status: "APPROVED",
    },
    select: { id: true },
  });
  customerIds.add(customer.id);
  return customer.id;
}

/** Grant live (valid) or expired access. */
async function grantAccess(
  customerId: string,
  opts: { expired?: boolean } = {},
): Promise<void> {
  await prisma.accessGrant.create({
    data: {
      customerId,
      grantedBy: "test",
      // Explicit null so the live-grant filter (`revokedAt: null`) matches on
      // MongoDB, where an omitted optional column is absent rather than null.
      revokedAt: null,
      expiresAt: opts.expired
        ? new Date(Date.now() - 60_000)
        : new Date(Date.now() + 86_400_000),
    },
  });
}

async function makeProduct(
  overrides: {
    price?: number;
    moq?: number | null;
    stockStatus?: "IN_STOCK" | "LOW" | "OUT_OF_STOCK";
    status?: "ACTIVE" | "INACTIVE";
    deletedAt?: Date | null;
  } = {},
): Promise<string> {
  const categoryId = await seedCategoryId();
  const sku = uniqueSku("ORD");
  const product = await prisma.product.create({
    data: {
      categoryId,
      name: `Ord Widget ${sku}`,
      slug: `ord-widget-${sku.toLowerCase()}`,
      sku,
      price: overrides.price ?? 49900,
      mrp: 59900,
      moq: overrides.moq === undefined ? null : overrides.moq,
      stockStatus: overrides.stockStatus ?? "IN_STOCK",
      status: overrides.status ?? "ACTIVE",
      deletedAt: overrides.deletedAt ?? null,
    },
    select: { id: true },
  });
  productIds.add(product.id);
  return product.id;
}

async function addCartLine(
  customerId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  await prisma.cartItem.create({
    data: { customerId, productId, quantity },
  });
}

beforeAll(async () => {
  await seedCategoryId();
});

afterEach(async () => {
  const cids = [...customerIds];
  const pids = [...productIds];
  customerIds.clear();
  productIds.clear();
  if (cids.length) {
    await prisma.order.deleteMany({ where: { customerId: { in: cids } } });
    await prisma.cartItem.deleteMany({ where: { customerId: { in: cids } } });
    await prisma.accessGrant.deleteMany({ where: { customerId: { in: cids } } });
    await prisma.notification.deleteMany({ where: { type: "order.placed" } });
    await prisma.customer.deleteMany({ where: { id: { in: cids } } });
  }
  if (pids.length) {
    await prisma.cartItem.deleteMany({ where: { productId: { in: pids } } });
    await prisma.product.deleteMany({ where: { id: { in: pids } } });
  }
});

describe("placeOrder — server-authoritative pricing (anti-cheat core)", () => {
  it("ignores any client-supplied price; the order uses the SERVER price", async () => {
    const customerId = await makeCustomer();
    await grantAccess(customerId);
    // Real server price is 49900 paise (₹499). Quantity 3.
    const productId = await makeProduct({ price: 49900 });
    await addCartLine(customerId, productId, 3);

    // The placeOrder API accepts ONLY { note?, idempotencyKey } — there is no
    // parameter through which a price could be passed. We additionally attempt
    // to smuggle a bogus price via extra fields on the input object to prove it
    // is dropped entirely.
    const bogus = { note: "hi", idempotencyKey: undefined } as unknown as {
      note?: string;
      idempotencyKey?: string;
    };
    (bogus as unknown as Record<string, unknown>).unitPricePaise = 1; // 1 paisa — must be ignored
    (bogus as unknown as Record<string, unknown>).subtotalPaise = 1;
    (bogus as unknown as Record<string, unknown>).price = 1;

    const result = await placeOrder(customerId, bogus);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The order total is the SERVER price * qty (49900 * 3), never the client's 1.
    expect(result.order.subtotalPaise).toBe(49900 * 3);
    expect(result.order.itemCount).toBe(3);
    expect(result.order.items).toHaveLength(1);
    expect(result.order.items[0]?.unitPricePaise).toBe(49900);
    expect(result.order.items[0]?.lineTotalPaise).toBe(49900 * 3);

    // And the cart was cleared in the same transaction.
    const remaining = await prisma.cartItem.count({ where: { customerId } });
    expect(remaining).toBe(0);

    // The persisted Order row also carries the server total (not the bogus one).
    const persisted = await prisma.order.findUnique({
      where: { orderNumber: result.order.orderNumber },
      select: { subtotalPaise: true, customerId: true },
    });
    expect(persisted?.subtotalPaise).toBe(49900 * 3);
    expect(persisted?.customerId).toBe(customerId);
  });

  it("prices the live cart server-side even when the catalog price changed", async () => {
    const customerId = await makeCustomer();
    await grantAccess(customerId);
    const productId = await makeProduct({ price: 10000 });
    await addCartLine(customerId, productId, 2);

    // Price changes AFTER the line was added — the cart must reflect the LIVE price.
    await prisma.product.update({ where: { id: productId }, data: { price: 25000 } });

    const cart = await priceCartForCustomer(customerId);
    expect(cart.subtotalPaise).toBe(25000 * 2);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Order snapshots the price live at placement.
    expect(result.order.subtotalPaise).toBe(25000 * 2);
  });
});

describe("placeOrder — empty cart", () => {
  it("rejects an empty cart", async () => {
    const customerId = await makeCustomer();
    await grantAccess(customerId);
    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty");
  });

  it("rejects a cart whose only line is unavailable (never silently orders it)", async () => {
    const customerId = await makeCustomer();
    await grantAccess(customerId);
    const productId = await makeProduct({ status: "INACTIVE" });
    await addCartLine(customerId, productId, 5);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("empty");
    expect(result.excluded?.some((l) => l.issues.includes("unavailable"))).toBe(true);
    // No order was created.
    const count = await prisma.order.count({ where: { customerId } });
    expect(count).toBe(0);
  });
});

describe("placeOrder — access re-check", () => {
  it("blocks an EXPIRED customer even though the cart was built while approved", async () => {
    const customerId = await makeCustomer();
    // Grant is expired — the cart still exists but access lapsed.
    await grantAccess(customerId, { expired: true });
    const productId = await makeProduct();
    await addCartLine(customerId, productId, 4);

    await expect(assertCanOrder(customerId)).rejects.toBeInstanceOf(OrderAccessError);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("access");
    // The cart is preserved (not cleared) and no order was created.
    const cartCount = await prisma.cartItem.count({ where: { customerId } });
    expect(cartCount).toBe(1);
    const orderCount = await prisma.order.count({ where: { customerId } });
    expect(orderCount).toBe(0);
  });

  it("blocks a customer whose status is not APPROVED", async () => {
    const customerId = await makeCustomer();
    await grantAccess(customerId); // valid grant...
    await prisma.customer.update({
      where: { id: customerId },
      data: { status: "BLOCKED" }, // ...but blocked.
    });
    const productId = await makeProduct();
    await addCartLine(customerId, productId, 2);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("access");
  });
});

describe("placeOrder — quantity clamping", () => {
  it("clamps a below-MOQ quantity up to the product MOQ before pricing", async () => {
    const customerId = await makeCustomer();
    await grantAccess(customerId);
    const productId = await makeProduct({ price: 1000, moq: 10 });
    await addCartLine(customerId, productId, 3); // below MOQ of 10

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Quantity clamped to 10 → subtotal 1000 * 10.
    expect(result.order.itemCount).toBe(10);
    expect(result.order.subtotalPaise).toBe(1000 * 10);
    expect(result.order.items[0]?.quantity).toBe(10);
  });
});

describe("idempotency", () => {
  it("dedups an identical cart placed twice in quick succession (no duplicate order)", async () => {
    const customerId = await makeCustomer();
    await grantAccess(customerId);
    const productId = await makeProduct({ price: 5000 });
    await addCartLine(customerId, productId, 2);

    const key = "dup-key-123";
    const first = await placeOrder(customerId, { idempotencyKey: key });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Re-add the same cart and place again with the same key — must return the
    // SAME order, not a new one.
    await addCartLine(customerId, productId, 2);
    const second = await placeOrder(customerId, { idempotencyKey: key });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.deduped).toBe(true);
    expect(second.order.orderNumber).toBe(first.order.orderNumber);

    const orderCount = await prisma.order.count({ where: { customerId } });
    expect(orderCount).toBe(1);
  });

  it("creates exactly ONE order for a concurrent double-submit with NO key (two-tab race)", async () => {
    // Regression for the concurrent-placement race: two placeOrder calls fired
    // together for the SAME cart with no idempotency key must not both commit.
    // The per-customer placement lock serialises them, so the second runs after
    // the first cleared the cart and either dedups or sees an empty cart.
    const customerId = await makeCustomer();
    await grantAccess(customerId);
    const productId = await makeProduct({ price: 16500 });
    await addCartLine(customerId, productId, 10);

    const [a, b] = await Promise.all([
      placeOrder(customerId, {}),
      placeOrder(customerId, {}),
    ]);

    // Exactly one order row exists for this customer, full stop.
    const orderCount = await prisma.order.count({ where: { customerId } });
    expect(orderCount).toBe(1);

    // At least one call succeeded; neither call threw a raw write-conflict.
    const oks = [a, b].filter((r) => r.ok);
    expect(oks.length).toBeGreaterThanOrEqual(1);
    // Any successful call must reference the single committed order.
    const numbers = new Set(oks.map((r) => (r.ok ? r.order.orderNumber : "")));
    expect(numbers.size).toBe(1);
  });

  it("creates exactly ONE order for a concurrent double-submit sharing an idempotency key", async () => {
    const customerId = await makeCustomer();
    await grantAccess(customerId);
    const productId = await makeProduct({ price: 4200 });
    await addCartLine(customerId, productId, 3);

    const key = "concurrent-key-xyz";
    const [a, b] = await Promise.all([
      placeOrder(customerId, { idempotencyKey: key }),
      placeOrder(customerId, { idempotencyKey: key }),
    ]);

    const orderCount = await prisma.order.count({ where: { customerId } });
    expect(orderCount).toBe(1);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.order.orderNumber).toBe(b.order.orderNumber);
    }
  });
});

describe("getOrderForCustomer — IDOR", () => {
  it("returns an order to its owner but not to another customer", async () => {
    const owner = await makeCustomer();
    await grantAccess(owner);
    const other = await makeCustomer();
    await grantAccess(other);
    const productId = await makeProduct({ price: 3000 });
    await addCartLine(owner, productId, 1);

    const placed = await placeOrder(owner, {});
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const asOwner = await getOrderForCustomer(owner, placed.order.orderNumber);
    expect(asOwner?.orderNumber).toBe(placed.order.orderNumber);

    // The other customer cannot read it even with the exact (random) number.
    const asOther = await getOrderForCustomer(other, placed.order.orderNumber);
    expect(asOther).toBeNull();
  });
});
