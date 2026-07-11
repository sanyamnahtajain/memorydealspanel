import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import type { CustomerViewer } from "@/server/types/viewer";
import {
  addToCart,
  getCart,
  updateQuantity,
  removeItem,
  clearCart,
  cartItemCount,
  CartError,
} from "./cart";

/**
 * Integration tests against the SEEDED local MongoDB. They prove the cart's
 * anti-cheat invariants:
 *   - add clamps a below-MOQ quantity up to the MOQ floor,
 *   - add caps an absurd quantity at the per-line ceiling,
 *   - a repeat add for the same line INCREMENTS (never duplicates),
 *   - IDOR: A's cart never contains B's lines, and A cannot remove B's line,
 *   - a non-approved viewer is REFUSED (NOT_APPROVED) — no cart row written,
 *   - the price gate: a gated viewer's cart carries NO unit price / subtotal,
 *   - out-of-stock is blocked; inactive/deleted products are flagged, not
 *     silently ordered.
 *
 * Everything this suite creates is tracked and hard-deleted in afterEach (cart
 * rows cascade on customer/product delete) so the seed set stays pristine.
 */

const MAX_QTY_PER_LINE = 100_000;

const customerIds = new Set<string>();
const productIds = new Set<string>();

async function makeCustomer(seed: string): Promise<string> {
  const passwordHash = await hashPassword("password1234");
  const phone = `+919${String(
    (Date.now() + Math.floor(Math.random() * 1e6)) % 1_000_000_000,
  ).padStart(9, "0")}`;
  const customer = await prisma.customer.create({
    data: {
      businessName: `Cart Biz ${seed}`,
      contactName: `Cart ${seed}`,
      phone,
      passwordHash,
      status: "APPROVED",
    },
    select: { id: true },
  });
  // Approved customers carry a live AccessGrant — the cart service now
  // re-verifies the grant against the DB on every mutation (defense in depth),
  // mirroring what placeOrder does, so an approved customer without a grant is
  // (correctly) refused. Seed one so the happy-path mutations are allowed.
  await prisma.accessGrant.create({
    data: {
      customerId: customer.id,
      grantedBy: "test",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  customerIds.add(customer.id);
  return customer.id;
}

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

async function makeProduct(
  overrides: {
    status?: "ACTIVE" | "INACTIVE";
    deletedAt?: Date | null;
    stockStatus?: "IN_STOCK" | "LOW" | "OUT_OF_STOCK";
    moq?: number | null;
    price?: number;
  } = {},
): Promise<string> {
  const categoryId = await seedCategoryId();
  const sku = uniqueSku("CART");
  const product = await prisma.product.create({
    data: {
      categoryId,
      name: `Cart Widget ${sku}`,
      slug: `cart-widget-${sku.toLowerCase()}`,
      sku,
      price: overrides.price ?? 49900,
      mrp: 59900,
      moq: overrides.moq ?? null,
      stockStatus: overrides.stockStatus ?? "IN_STOCK",
      status: overrides.status ?? "ACTIVE",
      deletedAt: overrides.deletedAt ?? null,
    },
    select: { id: true },
  });
  productIds.add(product.id);
  return product.id;
}

/** An APPROVED viewer (prices visible, may mutate) for a given customer id. */
function approvedViewer(customerId: string): CustomerViewer {
  return { kind: "customer", customerId, priceAccess: true, status: "APPROVED" };
}

/** A PENDING viewer (no price access, cannot mutate). */
function pendingViewer(customerId: string): CustomerViewer {
  return { kind: "customer", customerId, priceAccess: false, status: "PENDING" };
}

/** An EXPIRED viewer — was approved, grant lapsed; must not mutate. */
function expiredViewer(customerId: string): CustomerViewer {
  return { kind: "customer", customerId, priceAccess: false, status: "EXPIRED" };
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
    await prisma.cartItem.deleteMany({ where: { customerId: { in: cids } } });
  }
  if (pids.length) {
    await prisma.cartItem.deleteMany({ where: { productId: { in: pids } } });
  }
  if (cids.length) {
    await prisma.accessGrant.deleteMany({ where: { customerId: { in: cids } } });
    await prisma.customer.deleteMany({ where: { id: { in: cids } } });
  }
  if (pids.length) {
    await prisma.product.deleteMany({ where: { id: { in: pids } } });
  }
});

describe("addToCart — clamps & caps", () => {
  it("clamps a below-MOQ quantity up to the MOQ floor", async () => {
    const customerId = await makeCustomer("moq");
    const productId = await makeProduct({ moq: 10 });

    const result = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 3,
    });
    expect(result.quantity).toBe(10);
    expect(result.clamped).toBe(true);
    expect(result.itemCount).toBe(10);
  });

  it("caps an absurd quantity at the per-line ceiling", async () => {
    const customerId = await makeCustomer("cap");
    const productId = await makeProduct();

    const result = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 5_000_000,
    });
    expect(result.quantity).toBe(MAX_QTY_PER_LINE);
    expect(result.clamped).toBe(true);
  });

  it("increments an existing line instead of duplicating it", async () => {
    const customerId = await makeCustomer("dup");
    const productId = await makeProduct();

    await addToCart(approvedViewer(customerId), { productId, quantity: 2 });
    const second = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 3,
    });

    expect(second.quantity).toBe(5);
    expect(second.lineCount).toBe(1);
    // Exactly one row exists for this (customer, product, no-variant).
    const rows = await prisma.cartItem.count({
      where: { customerId, productId },
    });
    expect(rows).toBe(1);
  });
});

describe("addToCart — access gate", () => {
  it("refuses a PENDING (non-approved) viewer and writes no row", async () => {
    const customerId = await makeCustomer("pending");
    const productId = await makeProduct();

    await expect(
      addToCart(pendingViewer(customerId), { productId, quantity: 1 }),
    ).rejects.toMatchObject({ code: "NOT_APPROVED" });
    expect(await cartItemCount(customerId)).toBe(0);
  });

  it("refuses an EXPIRED viewer even if the cart was built while approved", async () => {
    const customerId = await makeCustomer("expired");
    const productId = await makeProduct();

    // Build a line while approved.
    await addToCart(approvedViewer(customerId), { productId, quantity: 1 });
    // Access lapses — a further add is refused.
    await expect(
      addToCart(expiredViewer(customerId), { productId, quantity: 1 }),
    ).rejects.toBeInstanceOf(CartError);
  });

  it("refuses a viewer with FORGED approved flags whose live grant is revoked (DB re-check)", async () => {
    // Defense in depth: even a hand-forged viewer that claims priceAccess=true /
    // APPROVED (bypassing resolveViewer) cannot mutate the cart when the live DB
    // grant is gone. This closes the only server-internal gap where a mutation
    // trusted viewer flags without its own DB re-check.
    const customerId = await makeCustomer("forged");
    const productId = await makeProduct();
    // Revoke the live grant behind the (still forged-approved) viewer.
    await prisma.accessGrant.updateMany({
      where: { customerId },
      data: { revokedAt: new Date() },
    });

    await expect(
      addToCart(approvedViewer(customerId), { productId, quantity: 1 }),
    ).rejects.toMatchObject({ code: "NOT_APPROVED" });
    expect(await cartItemCount(customerId)).toBe(0);
  });
});

describe("addToCart — stock & availability", () => {
  it("blocks an out-of-stock product", async () => {
    const customerId = await makeCustomer("oos");
    const productId = await makeProduct({ stockStatus: "OUT_OF_STOCK" });

    await expect(
      addToCart(approvedViewer(customerId), { productId, quantity: 1 }),
    ).rejects.toMatchObject({ code: "OUT_OF_STOCK" });
  });

  it("blocks an inactive product", async () => {
    const customerId = await makeCustomer("inactive");
    const productId = await makeProduct({ status: "INACTIVE" });

    await expect(
      addToCart(approvedViewer(customerId), { productId, quantity: 1 }),
    ).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  });
});

describe("getCart — price gate & totals", () => {
  it("computes gated unit price and subtotal for an APPROVED viewer", async () => {
    const customerId = await makeCustomer("priced");
    const productId = await makeProduct({ price: 50000 });
    await addToCart(approvedViewer(customerId), { productId, quantity: 4 });

    const cart = await getCart(approvedViewer(customerId));
    expect(cart.priced).toBe(true);
    expect(cart.lineCount).toBe(1);
    const [line] = cart.lines;
    expect(line!.unitPricePaise).toBe(50000);
    expect(line!.lineTotalPaise).toBe(200000);
    expect(cart.subtotalPaise).toBe(200000);
    expect(cart.itemCount).toBe(4);
  });

  it("never leaks a price to a lapsed (EXPIRED) viewer", async () => {
    const customerId = await makeCustomer("gated");
    const productId = await makeProduct();
    // Build the line while approved.
    await addToCart(approvedViewer(customerId), { productId, quantity: 2 });

    const cart = await getCart(expiredViewer(customerId));
    expect(cart.priced).toBe(false);
    expect(cart.subtotalPaise).toBeNull();
    expect(cart.lines[0]!.unitPricePaise).toBeNull();
    expect(cart.lines[0]!.lineTotalPaise).toBeNull();
    // The line itself is still visible so they can see their frozen cart.
    expect(cart.lines[0]!.quantity).toBe(2);
  });

  it("flags an out-of-stock line as unavailable and excludes it from the subtotal", async () => {
    const customerId = await makeCustomer("stale-oos");
    const productId = await makeProduct({ price: 30000 });
    await addToCart(approvedViewer(customerId), { productId, quantity: 5 });

    // Product goes out of stock after it was carted.
    await prisma.product.update({
      where: { id: productId },
      data: { stockStatus: "OUT_OF_STOCK" },
    });

    const cart = await getCart(approvedViewer(customerId));
    expect(cart.lines[0]!.available).toBe(false);
    expect(cart.lines[0]!.issues).toContain("out-of-stock");
    // Excluded from the placement-accurate subtotal.
    expect(cart.subtotalPaise).toBe(0);
  });
});

describe("IDOR isolation", () => {
  it("A's cart never contains B's lines", async () => {
    const alice = await makeCustomer("alice");
    const bob = await makeCustomer("bob");
    const aliceProduct = await makeProduct();
    const bobProduct = await makeProduct();

    await addToCart(approvedViewer(alice), { productId: aliceProduct, quantity: 1 });
    await addToCart(approvedViewer(bob), { productId: bobProduct, quantity: 1 });

    const aliceCart = await getCart(approvedViewer(alice));
    const ids = aliceCart.lines.map((l) => l.productId);
    expect(ids).toContain(aliceProduct);
    expect(ids).not.toContain(bobProduct);
  });

  it("A removing B's product does not touch B's cart", async () => {
    const alice = await makeCustomer("alice-rm");
    const bob = await makeCustomer("bob-rm");
    const bobProduct = await makeProduct();
    await addToCart(approvedViewer(bob), { productId: bobProduct, quantity: 2 });

    // Alice removes a product she never carted (Bob's) — no-op for her; Bob's
    // cart is untouched.
    await removeItem(alice, { productId: bobProduct });
    expect(await cartItemCount(bob)).toBe(2);
  });
});

describe("updateQuantity & clearCart", () => {
  it("sets an exact quantity, clamped to the MOQ floor", async () => {
    const customerId = await makeCustomer("update");
    const productId = await makeProduct({ moq: 6 });
    await addToCart(approvedViewer(customerId), { productId, quantity: 6 });

    const set = await updateQuantity(approvedViewer(customerId), {
      productId,
      quantity: 2, // below MOQ → clamps to 6
    });
    expect(set.quantity).toBe(6);
    expect(set.clamped).toBe(true);
  });

  it("clearCart empties everything for the customer", async () => {
    const customerId = await makeCustomer("clear");
    const a = await makeProduct();
    const b = await makeProduct();
    await addToCart(approvedViewer(customerId), { productId: a, quantity: 1 });
    await addToCart(approvedViewer(customerId), { productId: b, quantity: 1 });
    expect(await cartItemCount(customerId)).toBe(2);

    await clearCart(customerId);
    expect(await cartItemCount(customerId)).toBe(0);
  });
});
