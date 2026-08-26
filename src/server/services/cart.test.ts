import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MAX_QTY } from "@/lib/quantity";

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
  setCartRequirement,
  CartError,
} from "./cart";
import { publicBaseOrEmpty } from "@/server/storage/r2";

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
    packMultiple?: number | null;
    price?: number;
    allowRequirementNotes?: boolean;
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
      packMultiple: overrides.packMultiple ?? null,
      stockStatus: overrides.stockStatus ?? "IN_STOCK",
      allowRequirementNotes: overrides.allowRequirementNotes ?? false,
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

  it("rounds an off-pack quantity UP to the next pack multiple", async () => {
    const customerId = await makeCustomer("pack");
    const productId = await makeProduct({ moq: 10, packMultiple: 10 });

    const result = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 25,
    });
    expect(result.quantity).toBe(30);
    expect(result.clamped).toBe(true);
  });

  it("pack-aligns the floor when MOQ is not a multiple", async () => {
    const customerId = await makeCustomer("packfloor");
    const productId = await makeProduct({ moq: 15, packMultiple: 10 });

    const result = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 1,
    });
    expect(result.quantity).toBe(20); // smallest pack multiple >= MOQ 15
  });

  it("re-aligns a merged add onto the pack", async () => {
    const customerId = await makeCustomer("packmerge");
    const productId = await makeProduct({ moq: 10, packMultiple: 10 });

    await addToCart(approvedViewer(customerId), { productId, quantity: 10 });
    const merged = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 5, // 10 + 5 = 15 → rounds to 20
    });
    expect(merged.quantity).toBe(20);
    expect(merged.clamped).toBe(true);
  });

  it("caps an absurd quantity at the per-line ceiling", async () => {
    const customerId = await makeCustomer("cap");
    const productId = await makeProduct();

    const result = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 5_000_000,
    });
    // The ceiling is now the ADMIN default (200) unless the product sets its
    // own maxQty — see src/lib/quantity.ts DEFAULT_MAX_QTY.
    expect(result.quantity).toBe(DEFAULT_MAX_QTY);
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

/* ------------------------------------------------------------------ */
/* Allocation breakdowns (per-model quantity splits)                   */
/* ------------------------------------------------------------------ */

describe("addToCart — allocation breakdowns", () => {
  const createdModelIds = new Set<string>();

  async function makeModel(name: string): Promise<string> {
    const row = await prisma.deviceModel.create({
      data: {
        name: `${name} ${uniqueSku("M")}`,
        slug: `${name.toLowerCase()}-${uniqueSku("m").toLowerCase()}`,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    createdModelIds.add(row.id);
    return row.id;
  }

  async function makeAllocProduct(overrides?: {
    moq?: number;
    packMultiple?: number;
    modelIds?: string[];
  }): Promise<string> {
    const productId = await makeProduct({
      moq: overrides?.moq ?? null,
      packMultiple: overrides?.packMultiple ?? null,
    });
    await prisma.product.update({
      where: { id: productId },
      data: {
        allocation: {
          kind: "DEVICE_MODEL",
          required: true,
          modelIds: overrides?.modelIds ?? [],
        },
      },
    });
    return productId;
  }

  afterEach(async () => {
    if (createdModelIds.size === 0) return;
    await prisma.deviceModel.deleteMany({
      where: { id: { in: [...createdModelIds] } },
    });
    createdModelIds.clear();
  });

  it("rejects an allocation product without a breakdown", async () => {
    const customerId = await makeCustomer("alloc-req");
    const productId = await makeAllocProduct();

    await expect(
      addToCart(approvedViewer(customerId), { productId, quantity: 10 }),
    ).rejects.toMatchObject({ code: "BREAKDOWN_REQUIRED" });
  });

  it("stores a valid breakdown and sums it into the quantity", async () => {
    const customerId = await makeCustomer("alloc-ok");
    const productId = await makeAllocProduct();
    const m1 = await makeModel("Realme");
    const m2 = await makeModel("S23");

    const result = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 30,
      breakdown: [
        { modelId: m1, qty: 10 },
        { modelId: m2, qty: 20 },
      ],
    });
    expect(result.quantity).toBe(30);

    const row = await prisma.cartItem.findFirst({
      where: { customerId, productId },
      select: { quantity: true, breakdown: true },
    });
    expect(row?.quantity).toBe(30);
    expect(row?.breakdown).toEqual([
      { modelId: m1, qty: 10 },
      { modelId: m2, qty: 20 },
    ]);
  });

  it("merges repeat adds per model", async () => {
    const customerId = await makeCustomer("alloc-merge");
    const productId = await makeAllocProduct();
    const m1 = await makeModel("Realme");
    const m2 = await makeModel("S23");

    await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 10,
      breakdown: [{ modelId: m1, qty: 10 }],
    });
    const merged = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 15,
      breakdown: [
        { modelId: m1, qty: 5 },
        { modelId: m2, qty: 10 },
      ],
    });
    expect(merged.quantity).toBe(25);

    const row = await prisma.cartItem.findFirst({
      where: { customerId, productId },
      select: { breakdown: true },
    });
    const map = new Map(
      (row?.breakdown as { modelId: string; qty: number }[]).map((e) => [
        e.modelId,
        e.qty,
      ]),
    );
    expect(map.get(m1)).toBe(15);
    expect(map.get(m2)).toBe(10);
  });

  it("rejects when the MOQ clamp would change the total (never invents a split)", async () => {
    const customerId = await makeCustomer("alloc-moq");
    const productId = await makeAllocProduct({ moq: 50 });
    const m1 = await makeModel("Realme");

    await expect(
      addToCart(approvedViewer(customerId), {
        productId,
        quantity: 30,
        breakdown: [{ modelId: m1, qty: 30 }],
      }),
    ).rejects.toMatchObject({
      code: "BREAKDOWN_SUM_MISMATCH",
      details: { requiredTotal: 50, providedTotal: 30 },
    });

    expect(
      await prisma.cartItem.count({ where: { customerId, productId } }),
    ).toBe(0);
  });

  it("rejects models outside the product's allow-list", async () => {
    const customerId = await makeCustomer("alloc-allow");
    const allowed = await makeModel("Allowed");
    const outsider = await makeModel("Outsider");
    const productId = await makeAllocProduct({ modelIds: [allowed] });

    await expect(
      addToCart(approvedViewer(customerId), {
        productId,
        quantity: 5,
        breakdown: [{ modelId: outsider, qty: 5 }],
      }),
    ).rejects.toMatchObject({ code: "BREAKDOWN_INVALID" });
  });

  it("rejects inactive models", async () => {
    const customerId = await makeCustomer("alloc-inactive");
    const productId = await makeAllocProduct();
    const m1 = await makeModel("Dead");
    await prisma.deviceModel.update({
      where: { id: m1 },
      data: { status: "INACTIVE" },
    });

    await expect(
      addToCart(approvedViewer(customerId), {
        productId,
        quantity: 5,
        breakdown: [{ modelId: m1, qty: 5 }],
      }),
    ).rejects.toMatchObject({ code: "BREAKDOWN_INVALID" });
  });

  it("ignores a stray breakdown on a normal product", async () => {
    const customerId = await makeCustomer("alloc-stray");
    const productId = await makeProduct();
    const m1 = await makeModel("Stray");

    const result = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 4,
      breakdown: [{ modelId: m1, qty: 4 }],
    });
    expect(result.quantity).toBe(4);
    const row = await prisma.cartItem.findFirst({
      where: { customerId, productId },
      select: { breakdown: true },
    });
    expect(row?.breakdown ?? null).toBeNull();
  });

  it("getCart resolves model names and flags a stale split", async () => {
    const customerId = await makeCustomer("alloc-read");
    const productId = await makeAllocProduct();
    const m1 = await makeModel("Readable");

    await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 5,
      breakdown: [{ modelId: m1, qty: 5 }],
    });

    let cart = await getCart(approvedViewer(customerId));
    let line = cart.lines.find((l) => l.productId === productId);
    expect(line?.allocationRequired).toBe(true);
    expect(line?.breakdown?.[0]?.qty).toBe(5);
    expect(line?.breakdown?.[0]?.name).toContain("Readable");
    expect(line?.issues).not.toContain("breakdown-mismatch");

    // Deactivate the model behind the cart's back → flagged, not repaired.
    await prisma.deviceModel.update({
      where: { id: m1 },
      data: { status: "INACTIVE" },
    });
    cart = await getCart(approvedViewer(customerId));
    line = cart.lines.find((l) => l.productId === productId);
    expect(line?.issues).toContain("breakdown-mismatch");
  });

  /* ---- Custom (typed) lines — models missing from the master list ---- */

  it("stores a custom (typed) line alongside master lines", async () => {
    const customerId = await makeCustomer("alloc-custom");
    const productId = await makeAllocProduct();
    const m1 = await makeModel("Alpha");

    const result = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 30,
      breakdown: [
        { modelId: m1, qty: 10 },
        { custom: true, name: "Nokia 3310", qty: 20 },
      ],
    });
    expect(result.quantity).toBe(30);

    const row = await prisma.cartItem.findFirst({
      where: { customerId, productId },
      select: { quantity: true, breakdown: true },
    });
    expect(row?.quantity).toBe(30);
    expect(row?.breakdown).toEqual([
      { modelId: m1, qty: 10 },
      { custom: true, name: "Nokia 3310", qty: 20 },
    ]);
  });

  it("merges repeat adds of a custom line case-insensitively, keeping the first name", async () => {
    const customerId = await makeCustomer("alloc-custom-merge");
    const productId = await makeAllocProduct();

    await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 10,
      breakdown: [{ custom: true, name: "Nokia 3310", qty: 10 }],
    });
    await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 15,
      breakdown: [{ custom: true, name: "NOKIA-3310", qty: 15 }],
    });

    const row = await prisma.cartItem.findFirst({
      where: { customerId, productId },
      select: { quantity: true, breakdown: true },
    });
    expect(row?.quantity).toBe(25);
    expect(row?.breakdown).toEqual([
      { custom: true, name: "Nokia 3310", qty: 25 },
    ]);
  });

  it("rejects a custom name that duplicates a master model already in the split", async () => {
    const customerId = await makeCustomer("alloc-custom-dup");
    const productId = await makeAllocProduct();
    const m1 = await makeModel("DupCheck");
    const m1Name = (await prisma.deviceModel.findUnique({
      where: { id: m1 },
      select: { name: true },
    }))!.name;

    await expect(
      addToCart(approvedViewer(customerId), {
        productId,
        quantity: 20,
        breakdown: [
          { modelId: m1, qty: 10 },
          { custom: true, name: m1Name.toUpperCase(), qty: 10 },
        ],
      }),
    ).rejects.toMatchObject({ code: "BREAKDOWN_INVALID" });
  });

  it("accepts a custom line on a RESTRICTED product — free text bypasses the allow-list by design", async () => {
    const customerId = await makeCustomer("alloc-custom-restricted");
    const m1 = await makeModel("OnList");
    const productId = await makeAllocProduct({ modelIds: [m1] });

    const result = await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 25,
      breakdown: [
        { modelId: m1, qty: 10 },
        { custom: true, name: "Off List Model", qty: 15 },
      ],
    });
    expect(result.quantity).toBe(25);
  });

  it("getCart projects a custom line with its typed name and no mismatch flag", async () => {
    const customerId = await makeCustomer("alloc-custom-read");
    const productId = await makeAllocProduct();

    await addToCart(approvedViewer(customerId), {
      productId,
      quantity: 10,
      breakdown: [{ custom: true, name: "Nokia 3310", qty: 10 }],
    });

    const cart = await getCart(approvedViewer(customerId));
    const line = cart.lines.find((l) => l.productId === productId);
    expect(line?.breakdown).toEqual([
      { modelId: null, custom: true, name: "Nokia 3310", qty: 10 },
    ]);
    expect(line?.issues).not.toContain("breakdown-mismatch");
  });
});

describe("setCartRequirement — notes & photos", () => {
  it("saves a sanitized note + allow-listed photos on a flagged line", async () => {
    const customerId = await makeCustomer("req-happy");
    const productId = await makeProduct({ allowRequirementNotes: true });
    const viewer = approvedViewer(customerId);
    await addToCart(viewer, { productId, quantity: 5 });

    const base = publicBaseOrEmpty();
    const mine = `${base}/order-notes/${customerId}/a.jpg`;
    const result = await setCartRequirement(viewer, {
      productId,
      note: "  20 × Realme 11\n20 × S23 Ultra  ",
      attachments: [
        { url: mine },
        { url: "https://evil.example.com/x.jpg" }, // dropped: foreign host
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.note).toBe("20 × Realme 11\n20 × S23 Ultra");
    expect(result.attachments).toEqual([{ url: mine }]);

    // The stored values round-trip through getCart's sanitizers too.
    const cart = await getCart(viewer);
    const line = cart.lines.find((l) => l.productId === productId);
    expect(line?.allowRequirementNotes).toBe(true);
    expect(line?.note).toBe("20 × Realme 11\n20 × S23 Ultra");
    expect(line?.attachments).toEqual([{ url: mine }]);
  });

  it("refuses when the line is not in the cart / the product is not flagged", async () => {
    const customerId = await makeCustomer("req-refuse");
    const viewer = approvedViewer(customerId);

    const flagged = await makeProduct({ allowRequirementNotes: true });
    const notInCart = await setCartRequirement(viewer, {
      productId: flagged,
      note: "hello",
    });
    expect(notInCart).toEqual({ ok: false, reason: "not-in-cart" });

    const plain = await makeProduct(); // flag off
    await addToCart(viewer, { productId: plain, quantity: 2 });
    const notAllowed = await setCartRequirement(viewer, {
      productId: plain,
      note: "hello",
    });
    expect(notAllowed).toEqual({ ok: false, reason: "not-allowed" });
    const cart = await getCart(viewer);
    expect(cart.lines.find((l) => l.productId === plain)?.note).toBeNull();
  });

  it("clearing works: empty note + empty attachments wipe the stored values", async () => {
    const customerId = await makeCustomer("req-clear");
    const productId = await makeProduct({ allowRequirementNotes: true });
    const viewer = approvedViewer(customerId);
    await addToCart(viewer, { productId, quantity: 1 });

    await setCartRequirement(viewer, { productId, note: "temp note" });
    const cleared = await setCartRequirement(viewer, {
      productId,
      note: "   ",
      attachments: [],
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.note).toBeNull();
    expect(cleared.attachments).toEqual([]);
  });
});
