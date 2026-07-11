import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import type { StockStatus } from "@/lib/schemas/shared";
import {
  deleteVariant,
  disableVariants,
  enableVariants,
  generateMatrix,
  isVariantServiceError,
  listVariants,
  setDefaultVariant,
  setOptionTypes,
  setVariantStatus,
  upsertVariant,
  VariantServiceError,
} from "./variants";

/**
 * Integration tests for the variant service against the SEEDED local MongoDB.
 *
 * They prove the phase-11 invariants:
 *  - generateMatrix creates exactly N = product of option-value counts rows,
 *    and is idempotent (re-running does not duplicate).
 *  - recompute sets Product.price = min ACTIVE variant price (the FROM facet),
 *    and stock = best of active variants.
 *  - hasVariants=false products are left UNTOUCHED (backward-compat).
 *  - single-variant enable seeds one row and edits identically.
 *  - SKU uniqueness (global) and duplicate-combo are rejected.
 *
 * Everything each test creates (products + their variants) is hard-deleted in
 * afterEach so the seed set stays pristine and re-runs are deterministic.
 */

const createdProductIds = new Set<string>();

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

/** Creates a plain (non-variant) product and tracks it for cleanup. */
async function makeProduct(overrides?: {
  price?: number;
  mrp?: number;
  stockStatus?: StockStatus;
}): Promise<{ id: string; sku: string }> {
  const sku = uniqueSku("VAR");
  const product = await prisma.product.create({
    data: {
      categoryId: await seedCategoryId(),
      name: `Variant Test ${Date.now()}`,
      slug: `variant-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sku,
      price: overrides?.price ?? 100000,
      mrp: overrides?.mrp,
      stockStatus: overrides?.stockStatus ?? "IN_STOCK",
      status: "ACTIVE",
    },
    select: { id: true, sku: true },
  });
  createdProductIds.add(product.id);
  return product;
}

afterEach(async () => {
  if (createdProductIds.size === 0) return;
  const ids = [...createdProductIds];
  await prisma.productVariant.deleteMany({ where: { productId: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  createdProductIds.clear();
});

const TWO_AXES = [
  { name: "Capacity", values: ["10000mAh", "20000mAh"] },
  { name: "Color", values: ["Black", "White"] },
];

describe("setOptionTypes + generateMatrix", () => {
  it("creates exactly the cartesian product of option values", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, TWO_AXES);
    await enableVariants(product.id);

    const variants = await generateMatrix(product.id);
    // 2 capacities x 2 colors = 4, but enableVariants seeded one combo already.
    expect(variants).toHaveLength(4);

    const combos = new Set(
      variants.map((v) => JSON.stringify(v.optionValues)),
    );
    expect(combos.size).toBe(4);
  });

  it("is idempotent: re-running does not duplicate rows", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, TWO_AXES);
    await enableVariants(product.id);

    const first = await generateMatrix(product.id);
    const second = await generateMatrix(product.id);
    expect(second).toHaveLength(first.length);
    expect(second).toHaveLength(4);
  });

  it("removes orphaned combos and adds new ones when axes change", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, TWO_AXES);
    await enableVariants(product.id);
    await generateMatrix(product.id);

    // Shrink to a single axis with two values -> 2 combos.
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    const reconciled = await generateMatrix(product.id);
    expect(reconciled).toHaveLength(2);
  });

  it("auto-suggests SKUs from base sku + slugged option values", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh"] },
    ]);
    await enableVariants(product.id);
    const variants = await generateMatrix(product.id);
    expect(variants).toHaveLength(1);
    expect(variants[0].sku.toLowerCase()).toContain("10000mah");
  });
});

describe("recompute FROM facet", () => {
  it("sets Product.price to the min ACTIVE variant price", async () => {
    const product = await makeProduct({ price: 999999 });
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    await enableVariants(product.id);
    const variants = await generateMatrix(product.id);

    // Price the two variants differently.
    await upsertVariant(product.id, { id: variants[0].id, price: 50000 });
    await upsertVariant(product.id, { id: variants[1].id, price: 80000 });

    const row = await prisma.product.findUnique({
      where: { id: product.id },
      select: { price: true },
    });
    expect(row?.price).toBe(50000);
  });

  it("ignores INACTIVE variants when there is an active one", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    await enableVariants(product.id);
    const variants = await generateMatrix(product.id);

    await upsertVariant(product.id, { id: variants[0].id, price: 30000 });
    await upsertVariant(product.id, { id: variants[1].id, price: 90000 });
    // Deactivate the cheaper one -> FROM should become 90000.
    await setVariantStatus(variants[0].id, "INACTIVE");

    const row = await prisma.product.findUnique({
      where: { id: product.id },
      select: { price: true },
    });
    expect(row?.price).toBe(90000);
  });

  it("sets stock to the best of active variants", async () => {
    const product = await makeProduct({ stockStatus: "OUT_OF_STOCK" });
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    await enableVariants(product.id);
    const variants = await generateMatrix(product.id);

    await upsertVariant(product.id, {
      id: variants[0].id,
      stockStatus: "OUT_OF_STOCK",
    });
    await upsertVariant(product.id, {
      id: variants[1].id,
      stockStatus: "IN_STOCK",
    });

    const row = await prisma.product.findUnique({
      where: { id: product.id },
      select: { stockStatus: true },
    });
    expect(row?.stockStatus).toBe("IN_STOCK");
  });

  it("marks the min-price active variant as the sole default", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    await enableVariants(product.id);
    const variants = await generateMatrix(product.id);

    await upsertVariant(product.id, { id: variants[0].id, price: 20000 });
    await upsertVariant(product.id, { id: variants[1].id, price: 70000 });

    const rows = await listVariants(product.id);
    const defaults = rows.filter((v) => v.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].price).toBe(20000);
  });
});

describe("backward-compat: hasVariants=false is untouched", () => {
  it("a plain product keeps its price and has no variant rows", async () => {
    const product = await makeProduct({ price: 123456 });

    const row = await prisma.product.findUnique({
      where: { id: product.id },
      select: { price: true, hasVariants: true },
    });
    expect(row?.hasVariants).toBe(false);
    expect(row?.price).toBe(123456);

    const count = await prisma.productVariant.count({
      where: { productId: product.id },
    });
    expect(count).toBe(0);
  });

  it("disableVariants keeps Product.price (the last FROM price)", async () => {
    const product = await makeProduct({ price: 999999 });
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    await enableVariants(product.id);
    const variants = await generateMatrix(product.id);
    await upsertVariant(product.id, { id: variants[0].id, price: 45000 });

    await disableVariants(product.id);
    const row = await prisma.product.findUnique({
      where: { id: product.id },
      select: { price: true, hasVariants: true },
    });
    expect(row?.hasVariants).toBe(false);
    // Price was recomputed to the FROM (45000) while enabled, and is retained.
    expect(row?.price).toBe(45000);
  });

  it("upsertVariant refuses a product that is not a variant product", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh"] },
    ]);
    await expect(
      upsertVariant(product.id, {
        sku: uniqueSku("X"),
        optionValues: { Capacity: "10000mAh" },
        price: 10000,
        stockStatus: "IN_STOCK",
        status: "ACTIVE",
        images: [],
        isDefault: false,
        sortOrder: 0,
      }),
    ).rejects.toBeInstanceOf(VariantServiceError);
  });
});

describe("enableVariants seeds a single variant", () => {
  it("creates exactly one default variant mirroring the base product", async () => {
    const product = await makeProduct({ price: 250000 });
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    await enableVariants(product.id);

    const variants = await listVariants(product.id);
    expect(variants).toHaveLength(1);
    expect(variants[0].isDefault).toBe(true);
    expect(variants[0].price).toBe(250000);

    const row = await prisma.product.findUnique({
      where: { id: product.id },
      select: { hasVariants: true, price: true },
    });
    expect(row?.hasVariants).toBe(true);
    expect(row?.price).toBe(250000);
  });

  it("requires option types before enabling", async () => {
    const product = await makeProduct();
    await expect(enableVariants(product.id)).rejects.toSatisfy(
      (e: unknown) =>
        isVariantServiceError(e) && e.code === "NO_OPTION_TYPES",
    );
  });
});

describe("invariants: unique SKU + no duplicate combo + price>0", () => {
  it("rejects a variant SKU already used by another product", async () => {
    const other = await makeProduct();
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh"] },
    ]);
    await enableVariants(product.id);
    const [seed] = await listVariants(product.id);

    await expect(
      upsertVariant(product.id, {
        id: seed.id,
        sku: other.sku, // collides with a base product SKU
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isVariantServiceError(e) && e.code === "DUPLICATE_SKU",
    );
  });

  it("rejects a second variant with the same option combination", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    await enableVariants(product.id); // seeds Capacity=10000mAh

    await expect(
      upsertVariant(product.id, {
        sku: uniqueSku("DUP"),
        optionValues: { Capacity: "10000mAh" },
        price: 10000,
        stockStatus: "IN_STOCK",
        status: "ACTIVE",
        images: [],
        isDefault: false,
        sortOrder: 1,
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isVariantServiceError(e) && e.code === "DUPLICATE_COMBO",
    );
  });

  it("rejects a variant whose price is not > 0 (schema)", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh"] },
    ]);
    await enableVariants(product.id);

    await expect(
      upsertVariant(product.id, {
        sku: uniqueSku("ZERO"),
        optionValues: { Capacity: "10000mAh" },
        // Deliberately invalid: price must be > 0 (rejected by the schema).
        price: 0,
        stockStatus: "IN_STOCK",
        status: "ACTIVE",
        images: [],
        isDefault: false,
        sortOrder: 1,
      }),
    ).rejects.toBeTruthy();
  });

  it("rejects option values outside the declared axis values", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh"] },
    ]);
    await enableVariants(product.id);

    await expect(
      upsertVariant(product.id, {
        sku: uniqueSku("BAD"),
        optionValues: { Capacity: "99999mAh" },
        price: 10000,
        stockStatus: "IN_STOCK",
        status: "ACTIVE",
        images: [],
        isDefault: false,
        sortOrder: 1,
      }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isVariantServiceError(e) && e.code === "INVALID_OPTION_VALUES",
    );
  });
});

describe("deleteVariant + setDefaultVariant", () => {
  it("deleting a variant recomputes the FROM price", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    await enableVariants(product.id);
    const variants = await generateMatrix(product.id);
    await upsertVariant(product.id, { id: variants[0].id, price: 15000 });
    await upsertVariant(product.id, { id: variants[1].id, price: 60000 });

    await deleteVariant(variants[0].id); // remove the cheaper one

    const row = await prisma.product.findUnique({
      where: { id: product.id },
      select: { price: true },
    });
    expect(row?.price).toBe(60000);
  });

  it("setDefaultVariant moves the default flag", async () => {
    const product = await makeProduct();
    await setOptionTypes(product.id, [
      { name: "Capacity", values: ["10000mAh", "20000mAh"] },
    ]);
    await enableVariants(product.id);
    const variants = await generateMatrix(product.id);

    const target = variants.find((v) => !v.isDefault) ?? variants[1];
    await setDefaultVariant(target.id);

    const rows = await listVariants(product.id);
    const defaults = rows.filter((v) => v.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe(target.id);
  });
});
