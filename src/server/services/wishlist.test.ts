import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import type { CustomerViewer } from "@/server/types/viewer";
import {
  addToWishlist,
  listWishlist,
  removeFromWishlist,
  toggleWishlist,
  wishlistCount,
  wishlistProductIds,
  WishlistProductError,
} from "./wishlist";

/**
 * Integration tests against the SEEDED local MongoDB. They prove the wishlist
 * invariants that matter:
 *   - add is idempotent (unique constraint ⇒ no duplicate, no throw),
 *   - remove works and is idempotent,
 *   - IDOR: a listing/count/id-set for customer A never includes B's saves,
 *   - the price gate: a non-approved viewer's entries carry NO price field.
 *
 * Every customer/product this suite creates is tracked and hard-deleted in
 * afterEach (wishlist rows cascade on customer/product delete) so the seed set
 * stays pristine and re-runs are deterministic.
 */

const customerIds = new Set<string>();
const productIds = new Set<string>();

async function makeCustomer(seed: string): Promise<string> {
  const passwordHash = await hashPassword("password1234");
  const phone = `+919${String((Date.now() + Math.floor(Math.random() * 1e6)) % 1_000_000_000).padStart(9, "0")}`;
  const customer = await prisma.customer.create({
    data: {
      businessName: `WL Biz ${seed}`,
      contactName: `WL ${seed}`,
      phone,
      passwordHash,
      status: "PENDING",
    },
    select: { id: true },
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
  overrides: { status?: "ACTIVE" | "INACTIVE"; deletedAt?: Date | null } = {},
): Promise<string> {
  const categoryId = await seedCategoryId();
  const sku = uniqueSku("WL");
  const product = await prisma.product.create({
    data: {
      categoryId,
      name: `WL Widget ${sku}`,
      slug: `wl-widget-${sku.toLowerCase()}`,
      sku,
      price: 49900,
      mrp: 59900,
      stockStatus: "IN_STOCK",
      status: overrides.status ?? "ACTIVE",
      deletedAt: overrides.deletedAt ?? null,
    },
    select: { id: true },
  });
  productIds.add(product.id);
  return product.id;
}

/** An APPROVED viewer (prices visible) for a given customer id. */
function approvedViewer(customerId: string): CustomerViewer {
  return { kind: "customer", customerId, priceAccess: true, status: "APPROVED" };
}

/** A PENDING viewer (no price access) for a given customer id. */
function pendingViewer(customerId: string): CustomerViewer {
  return { kind: "customer", customerId, priceAccess: false, status: "PENDING" };
}

beforeAll(async () => {
  await seedCategoryId();
});

afterEach(async () => {
  const cids = [...customerIds];
  const pids = [...productIds];
  customerIds.clear();
  productIds.clear();
  // Remove wishlist rows first (defensive — they also cascade), then the parents.
  if (cids.length) {
    await prisma.wishlistItem.deleteMany({ where: { customerId: { in: cids } } });
  }
  if (pids.length) {
    await prisma.wishlistItem.deleteMany({ where: { productId: { in: pids } } });
  }
  if (cids.length) {
    await prisma.customer.deleteMany({ where: { id: { in: cids } } });
  }
  if (pids.length) {
    await prisma.product.deleteMany({ where: { id: { in: pids } } });
  }
});

describe("addToWishlist", () => {
  it("adds a product and is idempotent on a repeat add", async () => {
    const customerId = await makeCustomer("add");
    const productId = await makeProduct();

    const first = await addToWishlist(customerId, productId);
    expect(first).toBe(true);
    expect(await wishlistCount(customerId)).toBe(1);

    // Repeat add is a no-op (unique constraint), does not throw, count unchanged.
    const second = await addToWishlist(customerId, productId);
    expect(second).toBe(false);
    expect(await wishlistCount(customerId)).toBe(1);
  });

  it("rejects a product that is not active/available", async () => {
    const customerId = await makeCustomer("add-inactive");
    const inactive = await makeProduct({ status: "INACTIVE" });
    await expect(addToWishlist(customerId, inactive)).rejects.toBeInstanceOf(
      WishlistProductError,
    );
    expect(await wishlistCount(customerId)).toBe(0);
  });

  it("rejects a soft-deleted product", async () => {
    const customerId = await makeCustomer("add-deleted");
    const deleted = await makeProduct({ deletedAt: new Date() });
    await expect(addToWishlist(customerId, deleted)).rejects.toBeInstanceOf(
      WishlistProductError,
    );
  });
});

describe("removeFromWishlist", () => {
  it("removes a saved product and is idempotent", async () => {
    const customerId = await makeCustomer("remove");
    const productId = await makeProduct();
    await addToWishlist(customerId, productId);

    const removed = await removeFromWishlist(customerId, productId);
    expect(removed).toBe(true);
    expect(await wishlistCount(customerId)).toBe(0);

    // Removing again matches nothing — no throw, returns false.
    const again = await removeFromWishlist(customerId, productId);
    expect(again).toBe(false);
  });
});

describe("toggleWishlist", () => {
  it("flips saved state on each call", async () => {
    const customerId = await makeCustomer("toggle");
    const productId = await makeProduct();

    const on = await toggleWishlist(customerId, productId);
    expect(on.saved).toBe(true);
    expect(await wishlistCount(customerId)).toBe(1);

    const off = await toggleWishlist(customerId, productId);
    expect(off.saved).toBe(false);
    expect(await wishlistCount(customerId)).toBe(0);
  });
});

describe("IDOR isolation", () => {
  it("never returns customer B's saves to customer A", async () => {
    const alice = await makeCustomer("alice");
    const bob = await makeCustomer("bob");
    const aliceProduct = await makeProduct();
    const bobProduct = await makeProduct();

    await addToWishlist(alice, aliceProduct);
    await addToWishlist(bob, bobProduct);

    // listWishlist is scoped to the viewer's customerId only.
    const aliceList = await listWishlist(approvedViewer(alice));
    const aliceListIds = aliceList.map((e) => e.product.id);
    expect(aliceListIds).toContain(aliceProduct);
    expect(aliceListIds).not.toContain(bobProduct);

    // id-set and count are likewise scoped.
    const aliceSet = await wishlistProductIds(alice);
    expect(aliceSet.has(aliceProduct)).toBe(true);
    expect(aliceSet.has(bobProduct)).toBe(false);
    expect(await wishlistCount(alice)).toBe(1);
    expect(await wishlistCount(bob)).toBe(1);
  });

  it("A removing B's product does not touch B's wishlist", async () => {
    const alice = await makeCustomer("alice-rm");
    const bob = await makeCustomer("bob-rm");
    const bobProduct = await makeProduct();
    await addToWishlist(bob, bobProduct);

    // Alice attempts to remove a product she never saved (Bob's) — no-op for
    // her, and Bob's save is untouched.
    const removed = await removeFromWishlist(alice, bobProduct);
    expect(removed).toBe(false);
    expect(await wishlistCount(bob)).toBe(1);
  });
});

describe("price gate", () => {
  it("attaches a price for an APPROVED viewer", async () => {
    const customerId = await makeCustomer("priced");
    const productId = await makeProduct();
    await addToWishlist(customerId, productId);

    const [entry] = await listWishlist(approvedViewer(customerId));
    expect(entry).toBeDefined();
    expect("price" in entry!.product).toBe(true);
    expect((entry!.product as unknown as { price: number }).price).toBe(49900);
  });

  it("never leaks a price to a non-approved (PENDING) viewer", async () => {
    const customerId = await makeCustomer("gated");
    const productId = await makeProduct();
    await addToWishlist(customerId, productId);

    const [entry] = await listWishlist(pendingViewer(customerId));
    expect(entry).toBeDefined();
    // Price is STRUCTURALLY absent — not merely undefined.
    expect("price" in entry!.product).toBe(false);
    expect("mrp" in entry!.product).toBe(false);
  });

  it("omits products that became inactive/deleted after saving", async () => {
    const customerId = await makeCustomer("stale");
    const productId = await makeProduct();
    await addToWishlist(customerId, productId);

    // Simulate the product being pulled from the storefront.
    await prisma.product.update({
      where: { id: productId },
      data: { status: "INACTIVE" },
    });

    const list = await listWishlist(approvedViewer(customerId));
    expect(list.map((e) => e.product.id)).not.toContain(productId);
  });
});
