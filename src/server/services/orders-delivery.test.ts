import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import type { DeliveryRulesInput } from "@/lib/delivery";

/**
 * DELIVERY CHARGE × placement — integration tests against the local MongoDB.
 *
 * The owner's rule: the minimum delivery charge is REAL money, added to the
 * total. These tests pin the money rules that make that safe:
 *
 *   - ORDER OF OPERATIONS — delivery is a CHARGE, not goods. It lands AFTER the
 *     goods subtotal, AFTER the billing-group discount and AFTER the coupon, so
 *     no discount can ever eat into it and it can never inflate a discount.
 *   - GST — delivery stays OUT of the taxable base and is added after the tax
 *     computation (a deliberate assumption; see the comment in orders.ts).
 *   - MINIMUM ORDER VALUE — the floor is compared against GOODS, so the
 *     delivery charge can never help a small cart clear it.
 *   - HISTORY — an order with no frozen charge reads as 0 and its total never
 *     moves.
 *
 * The singleton SellerTaxProfile is MOCKED (as in orders-gst.test.ts) so these
 * tests never mutate the shared profile; the StoreSettings delivery rules ARE
 * written, and restored to OFF after every case.
 */

type MockProfile = {
  gstEnabled: boolean;
  stateCode: string | null;
  gstin: string | null;
  priceEntryMode: "TAX_EXCLUSIVE" | "TAX_INCLUSIVE";
  defaultGstRateBps: number;
  roundingMode: "LINE" | "INVOICE";
  defaultHsnCode: string | null;
};

let mockProfile: MockProfile = {
  gstEnabled: false,
  stateCode: null,
  gstin: null,
  priceEntryMode: "TAX_EXCLUSIVE",
  defaultGstRateBps: 1800,
  roundingMode: "LINE",
  defaultHsnCode: null,
};

vi.mock("@/server/services/tax-profile", () => ({
  getSellerTaxProfile: vi.fn(async () => ({
    id: "mock",
    key: "default",
    createdAt: new Date(),
    updatedAt: new Date(),
    displayMode: "EXCLUSIVE" as const,
    ...mockProfile,
  })),
}));

// Import AFTER the mock is registered so the service picks up the fake.
const { placeOrder, getOrderForCustomer, orderPayablePaise } = await import("./orders");
const { createBillingGroup } = await import("./billing-groups");

const DELIVERY_PAISE = 250_00;

const customerIds = new Set<string>();
const productIds = new Set<string>();
const brandIds = new Set<string>();
const groupIds = new Set<string>();
const couponIds = new Set<string>();

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
      businessName: "Delivery Biz",
      contactName: "Delivery Test",
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
    data: { name: `Delco ${t}`, slug: `delco-${t.toLowerCase()}` },
    select: { id: true },
  });
  brandIds.add(brand.id);
  return brand.id;
}

async function makeProduct(price: number, brandId: string | null = null): Promise<string> {
  const categoryId = await seedCategoryId();
  const sku = `DEL-${tag()}`;
  const product = await prisma.product.create({
    data: {
      categoryId,
      name: `Delivery Widget ${sku}`,
      slug: `delivery-widget-${sku.toLowerCase()}`,
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

/** A 10%-off, unscoped, active coupon. */
async function makeCoupon(): Promise<string> {
  const coupon = await prisma.coupon.create({
    data: {
      code: `DL${tag().slice(-6)}`,
      kind: "PERCENT",
      valueBps: 1000,
      active: true,
      deletedAt: null,
    },
    select: { id: true, code: true },
  });
  couponIds.add(coupon.id);
  return coupon.code;
}

async function makeDealerGroup(brandIdList: string[]): Promise<void> {
  const group = await createBillingGroup({
    name: `Dealer ${tag()}`,
    code: `X${tag().slice(0, 4)}`,
    color: "blue",
    active: true,
    sortOrder: 0,
    matcher: { kind: "brands", brandIds: brandIdList },
    rules: [{ kind: "tieredPercent", tiers: [{ fromPaise: 0, percentBps: 400 }] }],
    separateBill: true,
    couponStacking: true,
    notes: null,
  });
  groupIds.add(group.id);
}

async function addCartLine(customerId: string, productId: string, quantity: number) {
  await prisma.cartItem.create({ data: { customerId, productId, quantity } });
}

/** Turn the delivery charge on (at `minChargePaise`) or off, store-wide. */
async function setDelivery(
  rules: DeliveryRulesInput | null,
  minOrderValuePaise: number | null = null,
): Promise<void> {
  await prisma.storeSettings.upsert({
    where: { key: "default" },
    create: { key: "default", deliveryRules: rules ?? undefined, minOrderValuePaise },
    update: { deliveryRules: rules ?? null, minOrderValuePaise },
  });
}

const DELIVERY_ON: DeliveryRulesInput = {
  enabled: true,
  rules: [{ kind: "minCharge", minChargePaise: DELIVERY_PAISE }],
  note: null,
};

function setGst(enabled: boolean): void {
  mockProfile = {
    ...mockProfile,
    gstEnabled: enabled,
    stateCode: enabled ? "27" : null,
    defaultGstRateBps: 1800,
    roundingMode: "LINE",
  };
}

beforeAll(async () => {
  await seedCategoryId();
});

afterEach(async () => {
  // Always hand the singleton back OFF — every other suite assumes it.
  await setDelivery(null, null);
  setGst(false);

  const cids = [...customerIds];
  const pids = [...productIds];
  const bids = [...brandIds];
  const gids = [...groupIds];
  const coids = [...couponIds];
  customerIds.clear();
  productIds.clear();
  brandIds.clear();
  groupIds.clear();
  couponIds.clear();
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
  if (coids.length) await prisma.coupon.deleteMany({ where: { id: { in: coids } } });
});

describe("delivery OFF (kill switch)", () => {
  it("freezes NO charge and leaves every total exactly as before", async () => {
    await setDelivery(null);
    const customerId = await makeCustomer();
    const product = await makeProduct(1_000_00);
    await addCartLine(customerId, product, 2); // ₹2,000 goods

    const result = await placeOrder(customerId, {});
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.subtotalPaise).toBe(2_000_00);
    // Absent (not 0) — byte-for-byte a pre-feature order.
    expect(row!.deliveryChargePaise).toBeNull();
    expect(row!.deliveryDisclosure).toBeNull();
    expect(row!.grandTotalPaise).toBeNull(); // no GST, no discount ⇒ untouched
    expect(result.order.deliveryChargePaise).toBe(0);
    expect(orderPayablePaise(row!)).toBe(2_000_00);
  });
});

describe("delivery ON", () => {
  it("adds the charge ONCE, on top of the goods subtotal", async () => {
    await setDelivery(DELIVERY_ON);
    const customerId = await makeCustomer();
    const a = await makeProduct(1_000_00);
    const b = await makeProduct(500_00);
    await addCartLine(customerId, a, 2); // ₹2,000
    await addCartLine(customerId, b, 1); // ₹500  → ₹2,500 goods

    const result = await placeOrder(customerId, {});
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    // `subtotalPaise` stays PURE GOODS — every historical reader is unaffected.
    expect(row!.subtotalPaise).toBe(2_500_00);
    // ONE charge for the whole order, regardless of the line count.
    expect(row!.deliveryChargePaise).toBe(DELIVERY_PAISE);
    expect(result.order.deliveryChargePaise).toBe(DELIVERY_PAISE);
    expect(orderPayablePaise(row!)).toBe(2_500_00 + DELIVERY_PAISE);
    // The terms the buyer saw are frozen alongside the amount.
    expect(result.order.delivery).toEqual({
      minChargePaise: DELIVERY_PAISE,
      note: null,
    });
  });

  it("freezes the amount: a later rule change never moves a placed order", async () => {
    await setDelivery(DELIVERY_ON);
    const customerId = await makeCustomer();
    const product = await makeProduct(1_000_00);
    await addCartLine(customerId, product, 1);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The owner doubles the charge afterwards…
    await setDelivery({
      enabled: true,
      rules: [{ kind: "minCharge", minChargePaise: 500_00 }],
      note: null,
    });
    const reread = await getOrderForCustomer(customerId, result.order.orderNumber);
    expect(reread!.deliveryChargePaise).toBe(DELIVERY_PAISE);
    expect(reread!.delivery!.minChargePaise).toBe(DELIVERY_PAISE);
  });
});

describe("delivery × discounts (a charge is never discounted)", () => {
  it("COUPON: the discount is computed on goods only, and delivery is added after it", async () => {
    await setDelivery(DELIVERY_ON);
    const customerId = await makeCustomer();
    const product = await makeProduct(1_000_00);
    await addCartLine(customerId, product, 2); // ₹2,000 goods
    const couponCode = await makeCoupon(); // 10%

    const result = await placeOrder(customerId, { couponCode });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    // 10% of the GOODS (₹2,000) = ₹200 — NOT 10% of ₹2,250.
    expect(row!.discountPaise).toBe(200_00);
    expect(row!.deliveryChargePaise).toBe(DELIVERY_PAISE);
    // The frozen goods total nets the coupon and excludes delivery…
    expect(row!.grandTotalPaise).toBe(2_000_00 - 200_00);
    // …and the payable total adds the FULL, undiscounted charge last.
    expect(orderPayablePaise(row!)).toBe(2_000_00 - 200_00 + DELIVERY_PAISE);
  });

  it("BILLING GROUP: the bucket discount never applies to the charge", async () => {
    await setDelivery(DELIVERY_ON);
    const customerId = await makeCustomer();
    const brandId = await makeBrand();
    await makeDealerGroup([brandId]); // 4%
    const dealer = await makeProduct(5_000_00, brandId);
    await addCartLine(customerId, dealer, 2); // ₹10,000 dealer bucket → ₹400 off

    const result = await placeOrder(customerId, {});
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.groupDiscountPaise).toBe(400_00);
    expect(row!.deliveryChargePaise).toBe(DELIVERY_PAISE);
    // 4% of ₹10,000 — the charge was NOT part of the discounted base.
    expect(row!.grandTotalPaise).toBe(10_000_00 - 400_00);
    expect(orderPayablePaise(row!)).toBe(10_000_00 - 400_00 + DELIVERY_PAISE);
  });

  it("BOTH: group discount, then coupon, then delivery — in that order", async () => {
    await setDelivery(DELIVERY_ON);
    const customerId = await makeCustomer();
    const brandId = await makeBrand();
    await makeDealerGroup([brandId]);
    const dealer = await makeProduct(5_000_00, brandId);
    await addCartLine(customerId, dealer, 2); // ₹10,000 → 4% = ₹400 off
    const couponCode = await makeCoupon(); // 10% of ₹9,600 = ₹960

    const result = await placeOrder(customerId, { couponCode });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.groupDiscountPaise).toBe(400_00);
    expect(row!.discountPaise).toBe(960_00);
    expect(row!.grandTotalPaise).toBe(10_000_00 - 400_00 - 960_00);
    expect(orderPayablePaise(row!)).toBe(
      10_000_00 - 400_00 - 960_00 + DELIVERY_PAISE,
    );
  });
});

describe("delivery × GST", () => {
  it("stays OUT of the taxable base and is added after the tax", async () => {
    setGst(true);
    await setDelivery(DELIVERY_ON);
    const customerId = await makeCustomer();
    const product = await makeProduct(1_000_00);
    await addCartLine(customerId, product, 1); // ₹1,000 goods @18% exclusive

    const result = await placeOrder(customerId, {});
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.taxApplied).toBe(true);
    // Taxable value + GST are on the GOODS alone — no freight in the base.
    expect(row!.totalTaxablePaise).toBe(1_000_00);
    expect(row!.totalTaxPaise).toBe(180_00);
    // The frozen GST grand total still reconciles: taxable + tax.
    expect(row!.grandTotalPaise).toBe(1_180_00);
    // Delivery is separate, untaxed, and added last.
    expect(row!.deliveryChargePaise).toBe(DELIVERY_PAISE);
    expect(orderPayablePaise(row!)).toBe(1_180_00 + DELIVERY_PAISE);
  });
});

describe("delivery × minimum order value", () => {
  it("the charge does NOT help a small cart clear the floor", async () => {
    // Floor ₹2,000; goods ₹1,900; delivery ₹250 would "cover" it — it must not.
    await setDelivery(DELIVERY_ON, 2_000_00);
    const customerId = await makeCustomer();
    const product = await makeProduct(1_900_00);
    await addCartLine(customerId, product, 1);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("below-minimum");
    // The shortfall quoted is the GOODS shortfall, unchanged by delivery.
    expect(result.message).toContain("₹100");
  });

  it("goods exactly at the floor still place (delivery rides on top)", async () => {
    await setDelivery(DELIVERY_ON, 2_000_00);
    const customerId = await makeCustomer();
    const product = await makeProduct(2_000_00);
    await addCartLine(customerId, product, 1);

    const result = await placeOrder(customerId, {});
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const row = await prisma.order.findUnique({ where: { id: result.order.id } });
    expect(row!.deliveryChargePaise).toBe(DELIVERY_PAISE);
    expect(orderPayablePaise(row!)).toBe(2_000_00 + DELIVERY_PAISE);
  });
});

describe("historical orders", () => {
  it("an order frozen in the DISCLOSE-ONLY era reads as 0 and its total never moves", async () => {
    const customerId = await makeCustomer();
    // Exactly the shape placement produced back then: a frozen disclosure and
    // NO charge column at all.
    const legacy = await prisma.order.create({
      data: {
        orderNumber: `MD-LEGACY${tag()}`,
        customerId,
        status: "PLACED",
        items: [],
        subtotalPaise: 3_000_00,
        itemCount: 1,
        deliveryDisclosure: { minChargePaise: DELIVERY_PAISE, note: null },
      },
    });
    // …and the charge is switched ON store-wide afterwards.
    await setDelivery(DELIVERY_ON);

    const read = await getOrderForCustomer(customerId, legacy.orderNumber);
    expect(read).not.toBeNull();
    expect(read!.deliveryChargePaise).toBe(0);
    // The terms it was placed under are still shown…
    expect(read!.delivery).toEqual({ minChargePaise: DELIVERY_PAISE, note: null });
    // …but not a paisa is added to what it costs.
    expect(orderPayablePaise(legacy)).toBe(3_000_00);
  });
});
