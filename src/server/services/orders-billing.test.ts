import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { placeOrder, priceCartForCustomer } from "./orders";
import { createBillingGroup } from "./billing-groups";
import { parseOrderBillingSnapshot } from "@/lib/billing-groups/snapshot";

/**
 * Billing groups × placement — integration tests against the local MongoDB.
 *
 * Proves the owner's rule end-to-end: a cart with dealer-brand lines is
 * bucketed, the bucket's tiered discount is applied (4% under ₹25,000, 6% at
 * or above), the order FREEZES the snapshot + totals, and `subtotalPaise`
 * stays PRE-discount so every historical reader is unaffected. Also proves the
 * zero-impact path: with no active group the order carries none of the new
 * fields at all.
 */

const customerIds = new Set<string>();
const productIds = new Set<string>();
const brandIds = new Set<string>();
const groupIds = new Set<string>();

const tag = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

async function seedCategoryId(): Promise<string> {
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error("seed missing: no category");
  return category.id;
}

async function makeCustomer(): Promise<string> {
  const passwordHash = await hashPassword("password1234");
  const phone = `+919${String(
    (Date.now() + Math.floor(Math.random() * 1e6)) % 1_000_000_000,
  ).padStart(9, "0")}`;
  const customer = await prisma.customer.create({
    data: {
      businessName: "Billing Biz",
      contactName: "Billing Test",
      phone,
      passwordHash,
      status: "APPROVED",
    },
    select: { id: true },
  });
  customerIds.add(customer.id);
  await prisma.accessGrant.create({
    data: {
      customerId: customer.id,
      grantedBy: "test",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  return customer.id;
}

async function makeBrand(): Promise<string> {
  const t = tag();
  const brand = await prisma.brand.create({
    data: { name: `Zebro ${t}`, slug: `zebro-${t.toLowerCase()}` },
    select: { id: true },
  });
  brandIds.add(brand.id);
  return brand.id;
}

async function makeProduct(price: number, brandId: string | null): Promise<string> {
  const categoryId = await seedCategoryId();
  const sku = `BG-${tag()}`;
  const product = await prisma.product.create({
    data: {
      categoryId,
      name: `Billing Widget ${sku}`,
      slug: `billing-widget-${sku.toLowerCase()}`,
      sku,
      price,
      mrp: price,
      brandId,
      stockStatus: "IN_STOCK",
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true },
  });
  productIds.add(product.id);
  return product.id;
}

const couponIds = new Set<string>();

/** A 10%-off, unscoped, active coupon. */
async function makeCoupon(): Promise<string> {
  const coupon = await prisma.coupon.create({
    data: { code: `BG${tag().slice(-6)}`, kind: "PERCENT", valueBps: 1000, active: true, deletedAt: null },
    select: { id: true, code: true },
  });
  couponIds.add(coupon.id);
  return coupon.code;
}

async function makeDealerGroup(
  brandIdList: string[],
  opts: { couponStacking?: boolean } = {},
): Promise<string> {
  const group = await createBillingGroup({
    name: `Dealer ${tag()}`,
    code: `D${tag().slice(0, 4)}`,
    color: "blue",
    active: true,
    sortOrder: 0,
    matcher: { kind: "brands", brandIds: brandIdList },
    rules: [
      {
        kind: "tieredPercent",
        tiers: [
          { fromPaise: 0, percentBps: 400 },
          { fromPaise: 25_000_00, percentBps: 600 },
        ],
      },
    ],
    separateBill: true,
    couponStacking: opts.couponStacking ?? true,
    notes: "Dealer terms apply.",
  });
  groupIds.add(group.id);
  return group.id;
}

async function addCartLine(customerId: string, productId: string, quantity: number) {
  await prisma.cartItem.create({ data: { customerId, productId, quantity } });
}

beforeAll(async () => {
  await seedCategoryId();
  await prisma.storeSettings.upsert({
    where: { key: "default" },
    create: { key: "default", minOrderValuePaise: null },
    update: { minOrderValuePaise: null },
  });
});

afterEach(async () => {
  const cids = [...customerIds];
  const pids = [...productIds];
  const bids = [...brandIds];
  const gids = [...groupIds];
  customerIds.clear();
  productIds.clear();
  brandIds.clear();
  groupIds.clear();
  if (gids.length) await prisma.billingGroup.deleteMany({ where: { id: { in: gids } } });
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
  if (bids.length) await prisma.brand.deleteMany({ where: { id: { in: bids } } });
  const coids = [...couponIds];
  couponIds.clear();
  if (coids.length) await prisma.coupon.deleteMany({ where: { id: { in: coids } } });
});

describe("billing groups × coupons", () => {
  // Cart: ₹10,000 dealer (4% → ₹400 off) + ₹1,000 General; coupon = 10% unscoped.
  async function setup(couponStacking: boolean) {
    const customerId = await makeCustomer();
    const brandId = await makeBrand();
    await makeDealerGroup([brandId], { couponStacking });
    const dealer = await makeProduct(5_000_00, brandId);
    const other = await makeProduct(1_000_00, null);
    await addCartLine(customerId, dealer, 2);
    await addCartLine(customerId, other, 1);
    const couponCode = await makeCoupon();
    return { customerId, couponCode };
  }

  it("stacking ON: the coupon applies on the post-group-discount subtotal", async () => {
    const { customerId, couponCode } = await setup(true);
    const result = await placeOrder(customerId, { couponCode });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.groupDiscountPaise).toBe(400_00);
    // 10% of (₹10,000 − ₹400) + ₹1,000 = 10% of ₹10,600 = ₹1,060
    expect(row!.discountPaise).toBe(1_060_00);
    expect(row!.grandTotalPaise).toBe(11_000_00 - 400_00 - 1_060_00);
  });

  it("stacking OFF: the dealer bucket is invisible to the coupon", async () => {
    const { customerId, couponCode } = await setup(false);
    const result = await placeOrder(customerId, { couponCode });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.groupDiscountPaise).toBe(400_00);
    // Only the ₹1,000 General line is coupon-eligible → 10% = ₹100.
    expect(row!.discountPaise).toBe(100_00);
    expect(row!.grandTotalPaise).toBe(11_000_00 - 400_00 - 100_00);
  });
});

describe("billing groups at placement", () => {
  it("4% under ₹25,000: buckets the dealer lines, freezes the snapshot, keeps subtotal pre-discount", async () => {
    const customerId = await makeCustomer();
    const brandId = await makeBrand();
    await makeDealerGroup([brandId]);
    const dealer = await makeProduct(5_000_00, brandId); // ₹5,000
    const other = await makeProduct(1_000_00, null); // ₹1,000 (General)
    await addCartLine(customerId, dealer, 2); // ₹10,000 dealer bucket → 4%
    await addCartLine(customerId, other, 1);

    // The cart preview agrees with what placement will freeze.
    const preview = await priceCartForCustomer(customerId);
    expect(preview.billing.isSplit).toBe(true);
    expect(preview.billing.groupDiscountPaise).toBe(400_00);
    expect(preview.billing.buckets[0].appliedTier?.percentBps).toBe(400);
    expect(preview.billing.buckets[0].nextTier?.remainingPaise).toBe(15_000_00);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row).not.toBeNull();
    // PRE-discount subtotal is untouched (historical readers, dedup, ceilings).
    expect(row!.subtotalPaise).toBe(11_000_00);
    expect(row!.groupDiscountPaise).toBe(400_00);
    expect(row!.discountPaise).toBeNull(); // no coupon
    expect(row!.grandTotalPaise).toBe(10_600_00);

    const snap = parseOrderBillingSnapshot(row!.billingGroups);
    expect(snap).not.toBeNull();
    expect(snap!.groupDiscountPaise).toBe(400_00);
    expect(snap!.buckets.map((b) => b.code)).toEqual([
      expect.stringMatching(/^D/),
      "GEN",
    ]);
    expect(snap!.buckets[0].separateBill).toBe(true);
    expect(snap!.buckets[0].notes).toBe("Dealer terms apply.");
    expect(snap!.buckets[0].appliedTier).toEqual({ fromPaise: 0, percentBps: 400 });
    expect(snap!.buckets[0].lineKeys).toEqual([`${dealer}:`]);
    expect(snap!.buckets[1].lineKeys).toEqual([`${other}:`]);

    // The line snapshot carries the brand id for future re-bucketing.
    const items = row!.items as { productId: string; brandId?: string }[];
    expect(items.find((i) => i.productId === dealer)?.brandId).toBe(brandId);
    expect(items.find((i) => i.productId === other)?.brandId).toBeUndefined();
  });

  it("exactly ₹25,000 in the dealer bucket → 6%", async () => {
    const customerId = await makeCustomer();
    const brandId = await makeBrand();
    await makeDealerGroup([brandId]);
    const dealer = await makeProduct(12_500_00, brandId);
    await addCartLine(customerId, dealer, 2); // ₹25,000 exactly

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.groupDiscountPaise).toBe(1_500_00);
    expect(row!.grandTotalPaise).toBe(23_500_00);
    const snap = parseOrderBillingSnapshot(row!.billingGroups)!;
    expect(snap.buckets[0].appliedTier?.percentBps).toBe(600);
  });

  it("with NO active group the order is byte-for-byte pre-feature (no new fields)", async () => {
    const customerId = await makeCustomer();
    const brandId = await makeBrand();
    const dealer = await makeProduct(5_000_00, brandId);
    await addCartLine(customerId, dealer, 1);

    const preview = await priceCartForCustomer(customerId);
    expect(preview.billing.isSplit).toBe(false);
    expect(preview.billing.groupDiscountPaise).toBe(0);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.groupDiscountPaise).toBeNull();
    expect(row!.billingGroups).toBeNull();
    expect(row!.grandTotalPaise).toBeNull(); // pre-GST, no discount ⇒ untouched
    expect(row!.subtotalPaise).toBe(5_000_00);
  });

  it("an INACTIVE group is a kill switch — no discount, no snapshot", async () => {
    const customerId = await makeCustomer();
    const brandId = await makeBrand();
    const gid = await makeDealerGroup([brandId]);
    await prisma.billingGroup.update({ where: { id: gid }, data: { active: false } });
    const dealer = await makeProduct(5_000_00, brandId);
    await addCartLine(customerId, dealer, 1);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.groupDiscountPaise).toBeNull();
    expect(row!.billingGroups).toBeNull();
  });
});
