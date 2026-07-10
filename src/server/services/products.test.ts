import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import type { CreateProductInput } from "@/lib/schemas/product";
import {
  createProduct,
  duplicateProduct,
  isProductServiceError,
  restoreProduct,
  setProductStatus,
  softDeleteProduct,
  updateProduct,
  ProductServiceError,
} from "./products";

/**
 * Integration tests against the SEEDED local MongoDB. They prove the service
 * invariants: auto-slug, unique-SKU rejection, duplicate cloning, and the
 * soft-delete / restore lifecycle. Every product this suite creates is tracked
 * and hard-deleted in afterEach so the seed stays pristine.
 */

const createdIds = new Set<string>();

/** A unique SKU per test run so repeated runs never collide. */
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

function baseInput(categoryId: string, sku: string): CreateProductInput {
  return {
    categoryId,
    name: "Test Widget",
    sku,
    price: 49900,
    mrp: 59900,
    stockStatus: "IN_STOCK",
    status: "ACTIVE",
    tags: ["test"],
    images: [],
  };
}

async function makeProduct(
  overrides: Partial<CreateProductInput> = {},
): Promise<{ id: string; sku: string; slug: string }> {
  const categoryId = overrides.categoryId ?? (await seedCategoryId());
  const sku = overrides.sku ?? uniqueSku("SVC");
  const product = await createProduct({
    ...baseInput(categoryId, sku),
    ...overrides,
    categoryId,
    sku,
  });
  createdIds.add(product.id);
  return { id: product.id, sku: product.sku, slug: product.slug };
}

beforeAll(async () => {
  // Fail fast if the seed is missing rather than producing confusing errors.
  await seedCategoryId();
});

afterEach(async () => {
  if (createdIds.size === 0) return;
  await prisma.product.deleteMany({
    where: { id: { in: [...createdIds] } },
  });
  createdIds.clear();
});

describe("createProduct", () => {
  it("derives a slug from the name and returns a priced DTO", async () => {
    const { id, slug } = await makeProduct({ name: "Samsung EVO+ 128GB" });
    expect(slug).toBe("samsung-evo-128gb");
    const row = await prisma.product.findUnique({ where: { id } });
    expect(row?.slug).toBe("samsung-evo-128gb");
  });

  it("rejects a create with a category that does not exist", async () => {
    await expect(
      createProduct(
        baseInput("0000000000000000000000ff", uniqueSku("NOCAT")),
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isProductServiceError(e) &&
        (e as ProductServiceError).code === "CATEGORY_NOT_FOUND",
    );
  });
});

describe("duplicate SKU handling", () => {
  it("rejects a second product with the same SKU (case-insensitive)", async () => {
    const categoryId = await seedCategoryId();
    const sku = uniqueSku("DUP");
    await makeProduct({ categoryId, sku });

    await expect(
      createProduct(baseInput(categoryId, sku.toLowerCase())),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isProductServiceError(e) &&
        (e as ProductServiceError).code === "DUPLICATE_SKU",
    );
  });

  it("rejects an update that collides with another product's SKU", async () => {
    const categoryId = await seedCategoryId();
    const skuA = uniqueSku("A");
    const skuB = uniqueSku("B");
    await makeProduct({ categoryId, sku: skuA });
    const b = await makeProduct({ categoryId, sku: skuB });

    await expect(
      updateProduct(b.id, { sku: skuA }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isProductServiceError(e) &&
        (e as ProductServiceError).code === "DUPLICATE_SKU",
    );
  });

  it("rejects a partial update that drops mrp below the persisted price", async () => {
    // Seed with price 49900 / mrp 59900, then push mrp under price alone.
    const p = await makeProduct();
    await expect(
      updateProduct(p.id, { mrp: 40000 }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isProductServiceError(e) &&
        (e as ProductServiceError).code === "INVALID_PRICE",
    );
  });

  it("allows an update that keeps the product's own SKU unchanged", async () => {
    const p = await makeProduct();
    const updated = await updateProduct(p.id, {
      sku: p.sku,
      name: "Renamed Widget",
    });
    expect(updated.sku).toBe(p.sku);
    expect(updated.name).toBe("Renamed Widget");
    expect(updated.slug).toBe("renamed-widget");
  });
});

describe("duplicateProduct", () => {
  it('clones with " (copy)" name, a fresh SKU, and INACTIVE status', async () => {
    const source = await makeProduct({ name: "Original", sku: uniqueSku("ORIG") });

    const clone = await duplicateProduct(source.id);
    createdIds.add(clone.id);

    expect(clone.id).not.toBe(source.id);
    expect(clone.name).toBe("Original (copy)");
    expect(clone.sku).not.toBe(source.sku);
    expect(clone.sku.toLowerCase()).toContain("-copy-");
    expect(clone.status).toBe("INACTIVE");
    expect(clone.slug).not.toBe(source.slug);
    // Copied money fields survive intact (integer paise).
    expect(clone.price).toBe(49900);
    expect(clone.mrp).toBe(59900);
  });
});

describe("soft-delete and restore lifecycle", () => {
  it("stamps deletedAt on soft-delete and clears it on restore", async () => {
    const p = await makeProduct();

    const deleted = await softDeleteProduct(p.id);
    expect(deleted.id).toBe(p.id);
    const afterDelete = await prisma.product.findUnique({
      where: { id: p.id },
      select: { deletedAt: true },
    });
    expect(afterDelete?.deletedAt).not.toBeNull();

    const restored = await restoreProduct(p.id);
    expect(restored.id).toBe(p.id);
    const afterRestore = await prisma.product.findUnique({
      where: { id: p.id },
      select: { deletedAt: true },
    });
    expect(afterRestore?.deletedAt).toBeNull();
  });

  it("throws NOT_FOUND when soft-deleting a missing product", async () => {
    await expect(
      softDeleteProduct("0000000000000000000000fe"),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isProductServiceError(e) &&
        (e as ProductServiceError).code === "NOT_FOUND",
    );
  });
});

describe("setProductStatus", () => {
  it("toggles between ACTIVE and INACTIVE", async () => {
    const p = await makeProduct({ status: "ACTIVE" });
    const inactive = await setProductStatus(p.id, "INACTIVE");
    expect(inactive.status).toBe("INACTIVE");
    const active = await setProductStatus(p.id, "ACTIVE");
    expect(active.status).toBe("ACTIVE");
  });
});
