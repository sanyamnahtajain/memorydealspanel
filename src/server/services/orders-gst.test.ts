import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import type { CustomerViewer } from "@/server/types/viewer";

/**
 * GST placement + cart-preview integration tests (Phase 13). Products, customers
 * and orders are real rows against the SEEDED local MongoDB; only the singleton
 * SellerTaxProfile is MOCKED per case (via `vi.mock` on getSellerTaxProfile), so
 * these tests never mutate the shared global profile and can't destabilise the
 * parallel suites that read it (which all assume the kill-switch is off).
 *
 * These prove the server-authoritative tax snapshot invariants:
 *   - INTRA split (CGST + SGST), INTER split (IGST), mixed rates, inclusive vs
 *     exclusive treatment, all frozen onto the Order.
 *   - RATE FREEZE: a later product price/rate change never mutates a placed
 *     order's snapshot.
 *   - KILL-SWITCH parity: with gstEnabled=false a placed order is byte-identical
 *     to a pre-GST order (all tax fields null, subtotalPaise is the total).
 *   - supplyType === null (no place of supply) still computes combined tax so
 *     the grand total is correct; no CGST/SGST/IGST split.
 */

// The current mock profile the fake getSellerTaxProfile returns. `setProfile`
// swaps it; every case sets what it needs before exercising the service.
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

// Import AFTER the mock is registered so the services pick up the fake.
const { placeOrder, priceCartForCustomer } = await import("./orders");
const { getCart } = await import("./cart");

const SELLER_STATE = "27"; // Maharashtra
const customerIds = new Set<string>();
const productIds = new Set<string>();
const categoryIds = new Set<string>();

function uniqueSku(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`.toUpperCase();
}

async function seedCategoryId(): Promise<string> {
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error("seed missing: no category");
  return category.id;
}

async function setProfile(input: {
  gstEnabled: boolean;
  stateCode?: string | null;
  gstin?: string | null;
  priceEntryMode?: "TAX_EXCLUSIVE" | "TAX_INCLUSIVE";
  defaultGstRateBps?: number;
  roundingMode?: "LINE" | "INVOICE";
  defaultHsnCode?: string | null;
}): Promise<void> {
  mockProfile = {
    gstEnabled: input.gstEnabled,
    stateCode: input.stateCode ?? null,
    gstin: input.gstin ?? null,
    priceEntryMode: input.priceEntryMode ?? "TAX_EXCLUSIVE",
    defaultGstRateBps: input.defaultGstRateBps ?? 1800,
    roundingMode: input.roundingMode ?? "LINE",
    defaultHsnCode: input.defaultHsnCode ?? null,
  };
}

async function makeCustomer(placeOfSupply?: string | null): Promise<string> {
  const passwordHash = await hashPassword("password1234");
  const phone = `+919${String(
    (Date.now() + Math.floor(Math.random() * 1e6)) % 1_000_000_000,
  ).padStart(9, "0")}`;
  const customer = await prisma.customer.create({
    data: {
      businessName: "GST Biz",
      contactName: "GST Test",
      phone,
      passwordHash,
      status: "APPROVED",
      gstStateCode: placeOfSupply ?? null,
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

async function makeProduct(overrides: {
  price: number;
  gstRateBps?: number | null;
  taxTreatment?: "TAX_EXCLUSIVE" | "TAX_INCLUSIVE" | null;
  hsnCode?: string | null;
}): Promise<string> {
  const categoryId = await seedCategoryId();
  const sku = uniqueSku("GST");
  const product = await prisma.product.create({
    data: {
      categoryId,
      name: `GST Widget ${sku}`,
      slug: `gst-widget-${sku.toLowerCase()}`,
      sku,
      price: overrides.price,
      stockStatus: "IN_STOCK",
      status: "ACTIVE",
      gstRateBps: overrides.gstRateBps ?? null,
      taxTreatment: overrides.taxTreatment ?? null,
      hsnCode: overrides.hsnCode ?? null,
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
  await prisma.cartItem.create({ data: { customerId, productId, quantity } });
}

beforeAll(async () => {
  await seedCategoryId();
});

afterEach(async () => {
  // Reset the MOCK profile to the kill-switch-off default (no DB write; the
  // shared singleton is never touched).
  await setProfile({ gstEnabled: false, stateCode: null, gstin: null });

  const cids = [...customerIds];
  const pids = [...productIds];
  const catids = [...categoryIds];
  customerIds.clear();
  productIds.clear();
  categoryIds.clear();
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
  if (catids.length) {
    await prisma.category.deleteMany({ where: { id: { in: catids } } });
  }
});

describe("placeOrder — GST snapshot (intra-state, exclusive)", () => {
  it("freezes CGST/SGST split + grand total for a same-state buyer", async () => {
    await setProfile({
      gstEnabled: true,
      stateCode: SELLER_STATE,
      gstin: "27AAAAA0000A1Z5",
      priceEntryMode: "TAX_EXCLUSIVE",
      defaultGstRateBps: 1800,
    });
    const customerId = await makeCustomer(SELLER_STATE); // intra-state
    const productId = await makeProduct({ price: 10000, gstRateBps: 1800, hsnCode: "8504" });
    await addCartLine(customerId, productId, 2); // line total 20000 paise taxable

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // subtotal is unchanged (taxable base): 20000
    expect(result.order.subtotalPaise).toBe(20000);

    const tax = result.order.tax;
    expect(tax).not.toBeNull();
    if (!tax) return;
    expect(tax.supplyType).toBe("INTRA");
    expect(tax.totalTaxablePaise).toBe(20000);
    expect(tax.totalTaxPaise).toBe(3600); // 18% of 20000
    expect(tax.totalCgstPaise).toBe(1800);
    expect(tax.totalSgstPaise).toBe(1800);
    expect(tax.totalIgstPaise).toBe(0);
    expect(tax.grandTotalPaise).toBe(23600);
    expect(tax.hsnSummary).toHaveLength(1);
    expect(tax.hsnSummary[0]?.hsnCode).toBe("8504");
    expect(tax.hsnSummary[0]?.cgstPaise).toBe(1800);

    // Per-line frozen breakup inside items[].
    const line = result.order.items[0];
    expect(line?.tax?.taxablePaise).toBe(20000);
    expect(line?.tax?.taxPaise).toBe(3600);
    expect(line?.tax?.cgstPaise).toBe(1800);
    expect(line?.tax?.sgstPaise).toBe(1800);
    expect(line?.tax?.gstRateBps).toBe(1800);

    // Persisted columns match the DTO.
    const persisted = await prisma.order.findUnique({
      where: { orderNumber: result.order.orderNumber },
      select: {
        taxApplied: true,
        supplyType: true,
        totalCgstPaise: true,
        totalSgstPaise: true,
        totalIgstPaise: true,
        grandTotalPaise: true,
        subtotalPaise: true,
      },
    });
    expect(persisted?.taxApplied).toBe(true);
    expect(persisted?.supplyType).toBe("INTRA");
    expect(persisted?.totalCgstPaise).toBe(1800);
    expect(persisted?.totalSgstPaise).toBe(1800);
    expect(persisted?.totalIgstPaise).toBeNull();
    expect(persisted?.grandTotalPaise).toBe(23600);
    expect(persisted?.subtotalPaise).toBe(20000);
  });
});

describe("placeOrder — GST snapshot (inter-state, IGST)", () => {
  it("freezes IGST for a different-state buyer", async () => {
    await setProfile({
      gstEnabled: true,
      stateCode: SELLER_STATE,
      gstin: "27AAAAA0000A1Z5",
      priceEntryMode: "TAX_EXCLUSIVE",
      defaultGstRateBps: 1800,
    });
    const customerId = await makeCustomer("29"); // Karnataka — inter-state
    const productId = await makeProduct({ price: 50000, gstRateBps: 1800 });
    await addCartLine(customerId, productId, 1);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tax = result.order.tax;
    expect(tax?.supplyType).toBe("INTER");
    expect(tax?.totalIgstPaise).toBe(9000); // 18% of 50000
    expect(tax?.totalCgstPaise).toBe(0);
    expect(tax?.totalSgstPaise).toBe(0);
    expect(tax?.grandTotalPaise).toBe(59000);
    expect(result.order.items[0]?.tax?.igstPaise).toBe(9000);

    const persisted = await prisma.order.findUnique({
      where: { orderNumber: result.order.orderNumber },
      select: { totalIgstPaise: true, totalCgstPaise: true },
    });
    expect(persisted?.totalIgstPaise).toBe(9000);
    expect(persisted?.totalCgstPaise).toBeNull();
  });
});

describe("placeOrder — mixed rates + inclusive treatment", () => {
  it("groups the HSN summary by rate and carves tax out of an inclusive price", async () => {
    await setProfile({
      gstEnabled: true,
      stateCode: SELLER_STATE,
      priceEntryMode: "TAX_EXCLUSIVE",
      defaultGstRateBps: 1800,
    });
    const customerId = await makeCustomer(SELLER_STATE);
    // Line A: exclusive 18% on 10000 → tax 1800, gross 11800.
    const a = await makeProduct({ price: 10000, gstRateBps: 1800, hsnCode: "8504" });
    // Line B: INCLUSIVE 12% on 11200 → taxable 10000, tax 1200, gross 11200.
    const b = await makeProduct({ price: 11200, gstRateBps: 1200, taxTreatment: "TAX_INCLUSIVE", hsnCode: "8517" });
    await addCartLine(customerId, a, 1);
    await addCartLine(customerId, b, 1);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tax = result.order.tax;
    expect(tax?.supplyType).toBe("INTRA");
    // Taxable: 10000 (A) + 10000 (B carved from inclusive) = 20000.
    expect(tax?.totalTaxablePaise).toBe(20000);
    // Tax: 1800 (A) + 1200 (B) = 3000.
    expect(tax?.totalTaxPaise).toBe(3000);
    // Gross: 11800 + 11200 = 23000.
    expect(tax?.grandTotalPaise).toBe(23000);
    // Two HSN groups (different hsn + rate).
    expect(tax?.hsnSummary).toHaveLength(2);

    // The inclusive line's snapshot: taxable < lineTotal (tax carved out).
    const bLine = result.order.items.find((i) => i.tax?.gstRateBps === 1200);
    expect(bLine?.tax?.taxablePaise).toBe(10000);
    expect(bLine?.tax?.taxPaise).toBe(1200);
    expect(bLine?.tax?.treatment).toBe("TAX_INCLUSIVE");
    // subtotal for an inclusive line remains the stored line total (11200).
    expect(bLine?.lineTotalPaise).toBe(11200);
  });
});

describe("placeOrder — rate freeze", () => {
  it("a later product price/rate change leaves the placed order unchanged", async () => {
    await setProfile({
      gstEnabled: true,
      stateCode: SELLER_STATE,
      priceEntryMode: "TAX_EXCLUSIVE",
      defaultGstRateBps: 1800,
    });
    const customerId = await makeCustomer(SELLER_STATE);
    const productId = await makeProduct({ price: 10000, gstRateBps: 1800 });
    await addCartLine(customerId, productId, 1);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const frozenGrand = result.order.tax?.grandTotalPaise;
    const frozenTax = result.order.tax?.totalTaxPaise;
    expect(frozenGrand).toBe(11800);
    expect(frozenTax).toBe(1800);

    // Catalog changes AFTER placement — price up, rate up.
    await prisma.product.update({
      where: { id: productId },
      data: { price: 99999, gstRateBps: 2800 },
    });

    // Re-read the persisted order — snapshot is immutable.
    const persisted = await prisma.order.findUnique({
      where: { orderNumber: result.order.orderNumber },
      select: {
        subtotalPaise: true,
        totalTaxPaise: true,
        grandTotalPaise: true,
        items: true,
      },
    });
    expect(persisted?.subtotalPaise).toBe(10000);
    expect(persisted?.totalTaxPaise).toBe(1800);
    expect(persisted?.grandTotalPaise).toBe(11800);
    const items = persisted?.items as { tax?: { gstRateBps: number } }[];
    expect(items[0]?.tax?.gstRateBps).toBe(1800);
  });
});

describe("placeOrder — no place of supply (combined)", () => {
  it("computes combined tax with no split; does not block placement", async () => {
    await setProfile({
      gstEnabled: true,
      stateCode: SELLER_STATE,
      priceEntryMode: "TAX_EXCLUSIVE",
      defaultGstRateBps: 1800,
    });
    const customerId = await makeCustomer(null); // no GSTIN / place of supply
    const productId = await makeProduct({ price: 10000, gstRateBps: 1800 });
    await addCartLine(customerId, productId, 1);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const tax = result.order.tax;
    expect(tax?.supplyType).toBeNull();
    expect(tax?.totalTaxPaise).toBe(1800); // combined, still correct
    expect(tax?.totalCgstPaise).toBe(0);
    expect(tax?.totalSgstPaise).toBe(0);
    expect(tax?.totalIgstPaise).toBe(0);
    expect(tax?.grandTotalPaise).toBe(11800);

    const persisted = await prisma.order.findUnique({
      where: { orderNumber: result.order.orderNumber },
      select: { supplyType: true, totalTaxPaise: true, totalCgstPaise: true },
    });
    expect(persisted?.supplyType).toBeNull();
    expect(persisted?.totalTaxPaise).toBe(1800);
    expect(persisted?.totalCgstPaise).toBeNull();
  });
});

describe("placeOrder — kill-switch parity", () => {
  it("with gstEnabled=false the order is identical to a pre-GST order", async () => {
    await setProfile({ gstEnabled: false, stateCode: SELLER_STATE });
    const customerId = await makeCustomer(SELLER_STATE);
    const productId = await makeProduct({ price: 10000, gstRateBps: 1800 });
    await addCartLine(customerId, productId, 3);

    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // No tax anywhere; subtotal is the total.
    expect(result.order.tax).toBeNull();
    expect(result.order.subtotalPaise).toBe(30000);
    expect(result.order.items[0]?.tax).toBeUndefined();

    const persisted = await prisma.order.findUnique({
      where: { orderNumber: result.order.orderNumber },
      select: {
        taxApplied: true,
        supplyType: true,
        totalTaxPaise: true,
        grandTotalPaise: true,
        subtotalPaise: true,
      },
    });
    expect(persisted?.taxApplied).toBe(false);
    expect(persisted?.supplyType).toBeNull();
    expect(persisted?.totalTaxPaise).toBeNull();
    expect(persisted?.grandTotalPaise).toBeNull();
    expect(persisted?.subtotalPaise).toBe(30000);
  });
});

describe("priceCartForCustomer — GST preview", () => {
  it("intra-state preview matches what placement will freeze", async () => {
    await setProfile({
      gstEnabled: true,
      stateCode: SELLER_STATE,
      priceEntryMode: "TAX_EXCLUSIVE",
      defaultGstRateBps: 1800,
    });
    const customerId = await makeCustomer(SELLER_STATE);
    const productId = await makeProduct({ price: 10000, gstRateBps: 1800 });
    await addCartLine(customerId, productId, 2);

    const cart = await priceCartForCustomer(customerId);
    expect(cart.taxPreview).not.toBeNull();
    expect(cart.taxPreview?.supplyType).toBe("INTRA");
    expect(cart.taxPreview?.totalTaxablePaise).toBe(20000);
    expect(cart.taxPreview?.totalTaxPaise).toBe(3600);
    expect(cart.taxPreview?.grandTotalPaise).toBe(23600);

    // And the placed order agrees to the paisa.
    const result = await placeOrder(customerId, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.tax?.grandTotalPaise).toBe(cart.taxPreview?.grandTotalPaise);
  });

  it("is null when the kill-switch is off", async () => {
    await setProfile({ gstEnabled: false, stateCode: SELLER_STATE });
    const customerId = await makeCustomer(SELLER_STATE);
    const productId = await makeProduct({ price: 10000, gstRateBps: 1800 });
    await addCartLine(customerId, productId, 1);

    const cart = await priceCartForCustomer(customerId);
    expect(cart.taxPreview).toBeNull();
    expect(cart.subtotalPaise).toBe(10000);
  });
});

function approvedViewer(customerId: string): CustomerViewer {
  return { kind: "customer", customerId, priceAccess: true, status: "APPROVED" };
}
function pendingViewer(customerId: string): CustomerViewer {
  return { kind: "customer", customerId, priceAccess: false, status: "PENDING" };
}

describe("getCart — GST preview (gated live view)", () => {
  it("attaches per-line + order-preview tax for a priced intra-state viewer", async () => {
    await setProfile({
      gstEnabled: true,
      stateCode: SELLER_STATE,
      priceEntryMode: "TAX_EXCLUSIVE",
      defaultGstRateBps: 1800,
    });
    const customerId = await makeCustomer(SELLER_STATE);
    const productId = await makeProduct({ price: 10000, gstRateBps: 1800 });
    await addCartLine(customerId, productId, 2);

    const cart = await getCart(approvedViewer(customerId));
    expect(cart.priced).toBe(true);
    expect(cart.subtotalPaise).toBe(20000);

    const line = cart.lines[0];
    expect(line?.tax?.gstRateBps).toBe(1800);
    expect(line?.tax?.taxInclusive).toBe(false);
    expect(line?.tax?.taxablePaise).toBe(20000);
    expect(line?.tax?.taxPaise).toBe(3600);

    expect(cart.tax?.supplyType).toBe("INTRA");
    expect(cart.tax?.totalCgstPaise).toBe(1800);
    expect(cart.tax?.totalSgstPaise).toBe(1800);
    expect(cart.tax?.grandTotalPaise).toBe(23600);
  });

  it("never sends any tax amount to a GATED viewer (even with GST on)", async () => {
    await setProfile({
      gstEnabled: true,
      stateCode: SELLER_STATE,
      defaultGstRateBps: 1800,
    });
    // A PENDING customer with a cart row (seeded directly — no grant needed).
    const passwordHash = await hashPassword("password1234");
    const phone = `+919${String(
      (Date.now() + Math.floor(Math.random() * 1e6)) % 1_000_000_000,
    ).padStart(9, "0")}`;
    const customer = await prisma.customer.create({
      data: {
        businessName: "Gated Biz",
        contactName: "Gated",
        phone,
        passwordHash,
        status: "PENDING",
        gstStateCode: SELLER_STATE,
      },
      select: { id: true },
    });
    customerIds.add(customer.id);
    const productId = await makeProduct({ price: 10000, gstRateBps: 1800 });
    await addCartLine(customer.id, productId, 2);

    const cart = await getCart(pendingViewer(customer.id));
    expect(cart.priced).toBe(false);
    expect(cart.subtotalPaise).toBeNull();
    expect(cart.tax).toBeNull();
    expect(cart.lines[0]?.tax).toBeNull();
    expect(cart.lines[0]?.unitPricePaise).toBeNull();
    // Adversarial: no tax paise field name survives in the serialized gated cart.
    const serialized = JSON.stringify(cart);
    expect(serialized).not.toMatch(/taxablePaise|taxPaise|grandTotalPaise/);
  });

  it("has NO tax when the kill-switch is off (exact pre-GST shape)", async () => {
    await setProfile({ gstEnabled: false, stateCode: SELLER_STATE });
    const customerId = await makeCustomer(SELLER_STATE);
    const productId = await makeProduct({ price: 10000, gstRateBps: 1800 });
    await addCartLine(customerId, productId, 2);

    const cart = await getCart(approvedViewer(customerId));
    expect(cart.priced).toBe(true);
    expect(cart.subtotalPaise).toBe(20000);
    expect(cart.tax).toBeNull();
    expect(cart.lines[0]?.tax).toBeNull();
  });
});
