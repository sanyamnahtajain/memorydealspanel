import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isPaise } from "@/lib/money";
import {
  ANON_VIEWER,
  type AdminViewer,
  type CustomerViewer,
} from "@/server/types/viewer";
import { prisma } from "@/server/db";
import { ForbiddenError, isForbiddenError } from "./guard";
import {
  getBySlugForViewer,
  listByCategoryForViewer,
  listForAdminGrid,
  listForViewer,
} from "./products";

/**
 * Integration tests against the SEEDED local MongoDB. They prove the price
 * gate end-to-end: the shape of the returned objects (not just their values)
 * differs by viewer, and unauthorised viewers never receive a `price` key.
 */

const APPROVED_VIEWER: CustomerViewer = {
  kind: "customer",
  customerId: "000000000000000000000001",
  priceAccess: true,
  status: "APPROVED",
};

// Viewers that must NOT see prices — one per denial reason.
const DENIED_VIEWERS: ReadonlyArray<[string, CustomerViewer]> = [
  [
    "pending",
    {
      kind: "customer",
      customerId: "000000000000000000000002",
      priceAccess: false,
      status: "PENDING",
    },
  ],
  [
    "expired",
    {
      kind: "customer",
      customerId: "000000000000000000000003",
      priceAccess: false,
      status: "EXPIRED",
    },
  ],
  [
    "blocked",
    {
      kind: "customer",
      customerId: "000000000000000000000004",
      priceAccess: false,
      status: "BLOCKED",
    },
  ],
  [
    "rejected",
    {
      kind: "customer",
      customerId: "000000000000000000000005",
      priceAccess: false,
      status: "REJECTED",
    },
  ],
  // Belt-and-braces: even a forged priceAccess=true is rejected because
  // status !== APPROVED.
  [
    "approved-status-mismatch",
    {
      kind: "customer",
      customerId: "000000000000000000000006",
      priceAccess: true,
      status: "EXPIRED",
    },
  ],
];

const ADMIN_VIEWER: AdminViewer = {
  kind: "admin",
  adminId: "0000000000000000000000aa",
  name: "Test Admin",
  roleId: null,
  permissions: ["*"],
};

async function firstActiveSlug(): Promise<string> {
  const row = await prisma.product.findFirst({
    where: { status: "ACTIVE", deletedAt: null },
    select: { slug: true },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new Error("seed missing: no active product");
  return row.slug;
}

describe("products DAL price gate", () => {
  it("anon viewer receives products with NO price key", async () => {
    const products = await listForViewer(ANON_VIEWER, { take: 5 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect("price" in p).toBe(false);
      expect("mrp" in p).toBe(false);
      expect("marginPct" in p).toBe(false);
      // Public fields still present.
      expect(typeof p.slug).toBe("string");
      expect(typeof p.name).toBe("string");
    }
  });

  it("approved viewer receives integer-paise price", async () => {
    const products = await listForViewer(APPROVED_VIEWER, { take: 5 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect("price" in p).toBe(true);
      // Narrow to priced shape.
      const priced = p as typeof p & { price: number };
      expect(Number.isInteger(priced.price)).toBe(true);
      expect(isPaise(priced.price)).toBe(true);
      expect(priced.price).toBeGreaterThan(0);
    }
  });

  it.each(DENIED_VIEWERS)(
    "%s viewer receives NO price key",
    async (_label, viewer) => {
      const products = await listForViewer(viewer, { take: 5 });
      expect(products.length).toBeGreaterThan(0);
      for (const p of products) {
        expect("price" in p).toBe(false);
        expect("mrp" in p).toBe(false);
      }
    },
  );

  it("getBySlugForViewer gates the same way", async () => {
    const slug = await firstActiveSlug();

    const anon = await getBySlugForViewer(ANON_VIEWER, slug);
    expect(anon).not.toBeNull();
    expect("price" in anon!).toBe(false);

    const approved = await getBySlugForViewer(APPROVED_VIEWER, slug);
    expect(approved).not.toBeNull();
    expect("price" in approved!).toBe(true);
    expect(isPaise((approved as { price: number }).price)).toBe(true);

    const pending = await getBySlugForViewer(DENIED_VIEWERS[0][1], slug);
    expect(pending).not.toBeNull();
    expect("price" in pending!).toBe(false);
  });

  it("getBySlugForViewer returns null for a missing slug", async () => {
    const missing = await getBySlugForViewer(
      APPROVED_VIEWER,
      "definitely-not-a-real-slug-zzz",
    );
    expect(missing).toBeNull();
  });

  it("listByCategoryForViewer gates prices per viewer", async () => {
    const anyProduct = await prisma.product.findFirst({
      where: { status: "ACTIVE", deletedAt: null },
      select: { categoryId: true },
    });
    expect(anyProduct).not.toBeNull();
    const categoryId = anyProduct!.categoryId;

    const anon = await listByCategoryForViewer(ANON_VIEWER, categoryId, {
      take: 5,
    });
    expect(anon.length).toBeGreaterThan(0);
    for (const p of anon) expect("price" in p).toBe(false);

    const approved = await listByCategoryForViewer(
      APPROVED_VIEWER,
      categoryId,
      { take: 5 },
    );
    expect(approved.length).toBeGreaterThan(0);
    for (const p of approved) expect("price" in p).toBe(true);
  });

  it("admin viewer sees prices via listForViewer", async () => {
    const products = await listForViewer(ADMIN_VIEWER, { take: 3 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      expect("price" in p).toBe(true);
      expect(isPaise((p as { price: number }).price)).toBe(true);
    }
  });

  it("derives a whole-number marginPct when mrp exists", async () => {
    const products = await listForViewer(APPROVED_VIEWER, { take: 50 });
    const withMargin = products.find(
      (p) => (p as { marginPct: number | null }).marginPct !== null,
    ) as { price: number; mrp: number | null; marginPct: number | null } | undefined;
    if (withMargin) {
      expect(Number.isInteger(withMargin.marginPct)).toBe(true);
      expect(withMargin.marginPct).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("GST threading — kill-switch OFF (default seed) keeps pre-GST shapes", () => {
  it("anon carries amount-free tax metadata and NO tax paise anywhere", async () => {
    const products = await listForViewer(ANON_VIEWER, { take: 10 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      // The non-monetary metadata key is always present…
      expect("tax" in p).toBe(true);
      expect(p.tax.gstRateBps).toBeNull();
      expect(p.tax.taxInclusive).toBe(false);
      // …and the priced-only breakdown is STRUCTURALLY absent for a gated view.
      expect("taxBreakdown" in p).toBe(false);
    }
    // Adversarial: no paise tax field name survives anywhere in the payload.
    const serialized = JSON.stringify(products);
    expect(serialized).not.toContain("taxBreakdown");
    expect(serialized).not.toContain("taxPaise");
    expect(serialized).not.toContain("taxablePaise");
    expect(serialized).not.toContain("grossPaise");
  });

  it("approved viewer gets taxBreakdown: null while GST is off (pre-GST total)", async () => {
    const products = await listForViewer(APPROVED_VIEWER, { take: 10 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      const priced = p as typeof p & { taxBreakdown: unknown };
      expect("taxBreakdown" in priced).toBe(true);
      expect(priced.taxBreakdown).toBeNull();
      expect(p.tax.gstRateBps).toBeNull();
    }
  });
});

describe("brand master on the public payload", () => {
  it("exposes brandRef {id,name,slug} to anon WITHOUT leaking price", async () => {
    // Find a product that references a brand master, via any active row.
    const linked = await prisma.product.findFirst({
      where: { status: "ACTIVE", deletedAt: null, brandId: { not: null } },
      select: { slug: true },
    });
    // The seed links products to brands; if that ever changes, skip loudly
    // rather than silently passing on an empty assertion.
    expect(linked, "seed missing: no active product linked to a brand").not.toBeNull();

    const anon = await getBySlugForViewer(ANON_VIEWER, linked!.slug);
    expect(anon).not.toBeNull();

    // Price gate intact: brand is public, but NO money keys are present.
    expect("price" in anon!).toBe(false);
    expect("mrp" in anon!).toBe(false);
    expect("marginPct" in anon!).toBe(false);

    // Brand master is present and shaped as the public projection.
    expect(anon!.brandRef).not.toBeNull();
    const brand = anon!.brandRef!;
    expect(typeof brand.id).toBe("string");
    expect(typeof brand.name).toBe("string");
    expect(typeof brand.slug).toBe("string");
    // Defence in depth: the nested brand object carries no price key either.
    expect("price" in brand).toBe(false);
  });

  it("lists brandRef for anon across a page with no price key", async () => {
    const products = await listForViewer(ANON_VIEWER, { take: 10 });
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) {
      // brandRef is always present as a key (object or null), never a price.
      expect("brandRef" in p).toBe(true);
      expect("price" in p).toBe(false);
      if (p.brandRef) {
        expect(typeof p.brandRef.name).toBe("string");
        expect("price" in p.brandRef).toBe(false);
      }
    }
  });
});

describe("variant products price gate (getBySlugForViewer)", () => {
  // A dedicated, self-contained variant fixture so the assertions don't depend
  // on the seed carrying variant products. Created before, torn down after.
  const SLUG = "zzz-variant-gate-test-powerbank";
  const SKU = "ZZZ-VAR-PB-PARENT";
  const VARIANT_SKUS = ["ZZZ-VAR-PB-10K-BLK", "ZZZ-VAR-PB-20K-BLK"] as const;
  let productId: string;

  beforeAll(async () => {
    const category = await prisma.category.findFirst({ select: { id: true } });
    if (!category) throw new Error("seed missing: no category");

    const product = await prisma.product.create({
      data: {
        categoryId: category.id,
        name: "ZZZ Variant Gate Test Power Bank",
        slug: SLUG,
        sku: SKU,
        // Denormalized "from" price = min active variant price (₹999.00).
        price: 99900,
        stockStatus: "IN_STOCK",
        status: "ACTIVE",
        // Mongo distinguishes an absent field from null; the storefront filter
        // is `deletedAt: null`, so we must set it explicitly (the seed does too).
        deletedAt: null,
        hasVariants: true,
        optionTypes: [
          { name: "Capacity", values: ["10000mAh", "20000mAh"] },
          { name: "Color", values: ["Black"] },
        ],
        variants: {
          create: [
            {
              sku: VARIANT_SKUS[0],
              optionValues: { Capacity: "10000mAh", Color: "Black" },
              price: 99900,
              mrp: 129900,
              stockStatus: "IN_STOCK",
              status: "ACTIVE",
              isDefault: true,
              sortOrder: 0,
            },
            {
              sku: VARIANT_SKUS[1],
              optionValues: { Capacity: "20000mAh", Color: "Black" },
              price: 149900,
              mrp: 199900,
              stockStatus: "LOW",
              status: "ACTIVE",
              isDefault: false,
              sortOrder: 1,
            },
          ],
        },
      },
      select: { id: true },
    });
    productId = product.id;
  });

  afterAll(async () => {
    if (productId) {
      await prisma.productVariant.deleteMany({ where: { productId } });
      await prisma.product.delete({ where: { id: productId } });
    }
  });

  it("anon: variants present but structurally carry NO price anywhere", async () => {
    const anon = await getBySlugForViewer(ANON_VIEWER, SLUG);
    expect(anon).not.toBeNull();

    // Product-level gate intact.
    expect("price" in anon!).toBe(false);
    expect("mrp" in anon!).toBe(false);

    // Variant axes are PUBLIC (needed to render the selector) and present.
    expect(anon!.hasVariants).toBe(true);
    expect(anon!.optionTypes).toEqual([
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
      { name: "Color", values: ["Black"] },
    ]);

    // Variants come back gated — one row per active variant.
    expect(anon!.variants).toHaveLength(2);
    for (const v of anon!.variants) {
      // The invariant: NO price key exists on any variant (not undefined —
      // structurally absent), and no money key anywhere on the variant.
      expect("price" in v).toBe(false);
      expect("mrp" in v).toBe(false);
      expect("marginPct" in v).toBe(false);
      // Public variant fields still present.
      expect(typeof v.sku).toBe("string");
      expect(typeof v.stockStatus).toBe("string");
      expect(v.optionValues).toBeTypeOf("object");
    }

    // Belt-and-braces: serialize the whole payload and assert no variant price
    // amount (999.00 / 1499.00 paise) leaked through any nested field.
    const serialized = JSON.stringify(anon);
    expect(serialized).not.toContain("99900");
    expect(serialized).not.toContain("149900");

    // Default variant is first (isDefault desc, then sortOrder).
    expect(anon!.variants[0].isDefault).toBe(true);
  });

  it("approved: variants carry integer-paise price + margin, from-price synced", async () => {
    const approved = await getBySlugForViewer(APPROVED_VIEWER, SLUG);
    expect(approved).not.toBeNull();

    // Product-level "from" price is the min active variant price.
    expect("price" in approved!).toBe(true);
    expect((approved as { price: number }).price).toBe(99900);

    expect(approved!.variants).toHaveLength(2);
    for (const v of approved!.variants) {
      const priced = v as typeof v & { price: number };
      expect("price" in priced).toBe(true);
      expect(isPaise(priced.price)).toBe(true);
      expect(priced.price).toBeGreaterThan(0);
    }
    // Margin derived where mrp > price.
    const withMrp = approved!.variants.find(
      (v) => "mrp" in v && v.mrp !== null,
    );
    expect(withMrp).toBeDefined();
    expect(
      (withMrp as unknown as { marginPct: number | null }).marginPct,
    ).not.toBeNull();
  });

  it("pending: same gate — variants present with NO price key", async () => {
    const pending = await getBySlugForViewer(DENIED_VIEWERS[0][1], SLUG);
    expect(pending).not.toBeNull();
    expect("price" in pending!).toBe(false);
    expect(pending!.variants).toHaveLength(2);
    for (const v of pending!.variants) {
      expect("price" in v).toBe(false);
      expect("mrp" in v).toBe(false);
    }
  });
});

describe("non-variant products are unchanged (backward-compat)", () => {
  it("carries hasVariants=false and empty variants/optionTypes", async () => {
    const slug = await firstActiveSlug();
    const anon = await getBySlugForViewer(ANON_VIEWER, slug);
    expect(anon).not.toBeNull();
    // The seed catalog is non-variant; the detail read must default cleanly.
    expect(anon!.hasVariants).toBe(false);
    expect(anon!.variants).toEqual([]);
    expect(anon!.optionTypes).toEqual([]);
    // And still no price for anon.
    expect("price" in anon!).toBe(false);
  });
});

describe("listForAdminGrid authorization", () => {
  it("throws ForbiddenError for anon", async () => {
    await expect(listForAdminGrid(ANON_VIEWER)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("throws ForbiddenError for a customer (even approved)", async () => {
    await expect(listForAdminGrid(APPROVED_VIEWER)).rejects.toSatisfy(
      isForbiddenError,
    );
  });

  it("returns priced rows for an admin", async () => {
    const rows = await listForAdminGrid(ADMIN_VIEWER, { take: 5 });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect("price" in r).toBe(true);
      expect(isPaise(r.price)).toBe(true);
    }
  });
});
