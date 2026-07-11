import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { makeUniqueSlug } from "@/lib/slug";
import type { EntityStatus } from "@/lib/schemas/shared";
import {
  createProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type ProductImageInput,
  type UpdateProductInput,
} from "@/lib/schemas/product";
import {
  toPricedProduct,
  type PricedProduct,
} from "@/server/dto/product";

/**
 * Product service layer — the write half of the catalog.
 *
 * These functions own all product mutations (create / update / duplicate /
 * status / soft-delete / restore) and the invariants that go with them:
 *
 *  - `name` derives a unique `slug` via lib/slug.makeUniqueSlug.
 *  - `sku` is globally unique (case-insensitive); duplicates are rejected
 *    with a typed `ProductServiceError { code: "DUPLICATE_SKU" }` rather than
 *    a raw Prisma P2002 so the action layer can surface a friendly message.
 *  - `categoryId` must reference an existing category.
 *  - All money is integer paise (validated upstream by schemas/product).
 *
 * Authorisation (assertAdmin) and audit logging live in the ACTION layer
 * (src/server/actions/products.ts) — this module is pure domain logic so it
 * stays unit-testable against the seeded DB without a session.
 */

/** Prices/enums always present: services return the admin (priced) shape. */
const PRICED_SELECT = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  sku: true,
  brand: true,
  brandRef: { select: { id: true, name: true, slug: true } },
  description: true,
  specs: true,
  moq: true,
  stockStatus: true,
  status: true,
  tags: true,
  images: true,
  price: true,
  mrp: true,
  // GST override columns — NON-MONETARY metadata, safe on the priced select and
  // fed to the effective-tax resolver / editor. Never read as a money amount.
  hsnCode: true,
  gstRateBps: true,
  taxTreatment: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

export type ProductServiceErrorCode =
  | "DUPLICATE_SKU"
  | "CATEGORY_NOT_FOUND"
  | "BRAND_NOT_FOUND"
  | "NOT_FOUND"
  | "INVALID_PRICE";

/**
 * Domain error thrown by the service layer for expected, recoverable failure
 * modes. Carries a stable `code` so the action layer maps it to a typed
 * `{ ok: false, error }` result without string matching.
 */
export class ProductServiceError extends Error {
  readonly code: ProductServiceErrorCode;

  constructor(code: ProductServiceErrorCode, message: string) {
    super(message);
    this.name = "ProductServiceError";
    this.code = code;
    Object.setPrototypeOf(this, ProductServiceError.prototype);
  }
}

export function isProductServiceError(
  error: unknown,
): error is ProductServiceError {
  return error instanceof ProductServiceError;
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

/** True when a product with this exact slug already exists. */
async function slugExists(slug: string, excludeId?: string): Promise<boolean> {
  const row = await prisma.product.findFirst({
    where: excludeId ? { slug, id: { not: excludeId } } : { slug },
    select: { id: true },
  });
  return row !== null;
}

/**
 * True when another product already uses this SKU (case-insensitive). SKUs are
 * unique in Mongo, but we check up-front (and case-insensitively) to return a
 * clean domain error instead of relying on the P2002 race at write time.
 */
async function skuTaken(sku: string, excludeId?: string): Promise<boolean> {
  const row = await prisma.product.findFirst({
    where: {
      sku: { equals: sku, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  return row !== null;
}

async function assertCategoryExists(categoryId: string): Promise<void> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!category) {
    throw new ProductServiceError(
      "CATEGORY_NOT_FOUND",
      "The selected category no longer exists.",
    );
  }
}

/**
 * Resolves a Brand master by id, returning its name. The name is mirrored into
 * the legacy `brand` string on the product for back-compat, so the old
 * free-text-driven reads (search, exports) keep working while the app moves to
 * the `brandId`/`brandRef` relation. Throws `BRAND_NOT_FOUND` for a stale id.
 */
async function resolveBrandName(brandId: string): Promise<string> {
  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { name: true },
  });
  if (!brand) {
    throw new ProductServiceError(
      "BRAND_NOT_FOUND",
      "The selected brand no longer exists.",
    );
  }
  return brand.name;
}

/** Normalises embedded images: exactly one primary, contiguous sortOrder. */
function normaliseImages(
  images: ProductImageInput[],
): Prisma.ProductImageCreateInput[] {
  if (images.length === 0) {
    return [];
  }
  const ordered = [...images].sort((a, b) => a.sortOrder - b.sortOrder);
  const primaryIndex = ordered.findIndex((image) => image.isPrimary);
  const resolvedPrimary = primaryIndex === -1 ? 0 : primaryIndex;
  return ordered.map((image, index) => ({
    url: image.url,
    thumbUrl: image.thumbUrl,
    sortOrder: index,
    isPrimary: index === resolvedPrimary,
  }));
}

/** Maps a P2002 unique-constraint error on `sku` to a domain error. */
function rethrowAsDuplicateSku(error: unknown, sku: string): never {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  ) {
    throw new ProductServiceError(
      "DUPLICATE_SKU",
      `SKU "${sku}" is already in use by another product.`,
    );
  }
  throw error;
}

async function findByIdOrThrow(id: string) {
  const row = await prisma.product.findUnique({
    where: { id },
    select: PRICED_SELECT,
  });
  if (!row) {
    throw new ProductServiceError("NOT_FOUND", "Product not found.");
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* createProduct                                                       */
/* ------------------------------------------------------------------ */

/**
 * Creates a product from validated input. Derives a unique slug from the name,
 * verifies the SKU is free and the category exists, then writes the row and
 * returns the priced DTO.
 */
export async function createProduct(
  input: CreateProductInput,
): Promise<PricedProduct> {
  const data = createProductSchema.parse(input);

  await assertCategoryExists(data.categoryId);
  if (await skuTaken(data.sku)) {
    throw new ProductServiceError(
      "DUPLICATE_SKU",
      `SKU "${data.sku}" is already in use by another product.`,
    );
  }

  // When a brand master is selected, mirror its name into the legacy `brand`
  // string for back-compat. `brandId` is the source of truth going forward.
  const brandName =
    data.brandId !== undefined
      ? await resolveBrandName(data.brandId)
      : data.brand;

  const slug = await makeUniqueSlug(data.name, (candidate) =>
    slugExists(candidate),
  );

  try {
    const row = await prisma.product.create({
      data: {
        categoryId: data.categoryId,
        name: data.name,
        slug,
        sku: data.sku,
        brand: brandName,
        brandId: data.brandId,
        description: data.description,
        specs: data.specs ?? undefined,
        price: data.price,
        mrp: data.mrp,
        moq: data.moq,
        stockStatus: data.stockStatus,
        status: data.status,
        tags: data.tags,
        images: normaliseImages(data.images),
        // GST overrides — non-monetary. A `null`/absent value stores null so the
        // effective tax is inherited from the category / seller profile.
        hsnCode: data.hsnCode ?? null,
        gstRateBps: data.gstRateBps ?? null,
        taxTreatment: data.taxTreatment ?? null,
      },
      select: PRICED_SELECT,
    });
    return toPricedProduct(row);
  } catch (error) {
    rethrowAsDuplicateSku(error, data.sku);
  }
}

/* ------------------------------------------------------------------ */
/* updateProduct                                                       */
/* ------------------------------------------------------------------ */

/**
 * Applies a partial update. Only the provided fields change; a new `slug` is
 * derived only when `name` changes, and SKU uniqueness is re-checked only when
 * `sku` changes. Returns the updated priced DTO.
 */
export async function updateProduct(
  id: string,
  patch: UpdateProductInput,
): Promise<PricedProduct> {
  const data = updateProductSchema.parse(patch);
  const existing = await findByIdOrThrow(id);

  if (data.categoryId !== undefined && data.categoryId !== existing.categoryId) {
    await assertCategoryExists(data.categoryId);
  }

  if (data.sku !== undefined && data.sku !== existing.sku) {
    if (await skuTaken(data.sku, id)) {
      throw new ProductServiceError(
        "DUPLICATE_SKU",
        `SKU "${data.sku}" is already in use by another product.`,
      );
    }
  }

  // mrp/price cross-field invariant: the update schema only enforces it when
  // BOTH are present in the patch. Re-check against the persisted value when
  // only one side changes so a partial edit can't invert the relationship.
  const nextPrice = data.price ?? existing.price;
  const nextMrp =
    data.mrp !== undefined ? data.mrp : existing.mrp ?? undefined;
  if (nextMrp !== undefined && nextMrp !== null && nextMrp < nextPrice) {
    throw new ProductServiceError(
      "INVALID_PRICE",
      "MRP must be greater than or equal to price.",
    );
  }

  const update: Prisma.ProductUpdateInput = {};
  if (data.categoryId !== undefined) {
    update.category = { connect: { id: data.categoryId } };
  }
  if (data.name !== undefined && data.name !== existing.name) {
    update.name = data.name;
    update.slug = await makeUniqueSlug(data.name, (candidate) =>
      slugExists(candidate, id),
    );
  } else if (data.name !== undefined) {
    update.name = data.name;
  }
  if (data.sku !== undefined) update.sku = data.sku;
  // Brand: `brandId` is authoritative. When it changes, connect/disconnect the
  // relation AND mirror the master's name into the legacy `brand` string. A
  // bare `brand` patch (no brandId) still updates the legacy string alone, for
  // back-compat with the old free-text path.
  if (data.brandId !== undefined) {
    update.brandRef = { connect: { id: data.brandId } };
    update.brand = await resolveBrandName(data.brandId);
  } else if (data.brand !== undefined) {
    update.brand = data.brand;
  }
  if (data.description !== undefined) update.description = data.description;
  if (data.specs !== undefined) update.specs = data.specs;
  if (data.price !== undefined) update.price = data.price;
  if (data.mrp !== undefined) update.mrp = data.mrp;
  if (data.moq !== undefined) update.moq = data.moq;
  if (data.stockStatus !== undefined) update.stockStatus = data.stockStatus;
  if (data.status !== undefined) update.status = data.status;
  if (data.tags !== undefined) update.tags = data.tags;
  if (data.images !== undefined) update.images = normaliseImages(data.images);
  // GST overrides — present key writes the value (null clears the override back
  // to "inherit"); an absent key leaves the stored value untouched.
  if (data.hsnCode !== undefined) update.hsnCode = data.hsnCode ?? null;
  if (data.gstRateBps !== undefined) update.gstRateBps = data.gstRateBps ?? null;
  if (data.taxTreatment !== undefined) {
    update.taxTreatment = data.taxTreatment ?? null;
  }

  try {
    const row = await prisma.product.update({
      where: { id },
      data: update,
      select: PRICED_SELECT,
    });
    return toPricedProduct(row);
  } catch (error) {
    rethrowAsDuplicateSku(error, data.sku ?? existing.sku);
  }
}

/* ------------------------------------------------------------------ */
/* duplicateProduct                                                    */
/* ------------------------------------------------------------------ */

/** Appends a short random suffix to a base SKU: "AB-12" -> "AB-12-copy-x7f2". */
function suffixSku(base: string): string {
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-copy-${suffix}`.slice(0, 64);
}

/**
 * Clones an existing product into a new draft: same fields, name suffixed with
 * " (copy)", a fresh unique SKU and slug, and status forced to INACTIVE so the
 * clone never appears on the storefront before the admin reviews it.
 */
export async function duplicateProduct(id: string): Promise<PricedProduct> {
  const source = await findByIdOrThrow(id);

  const name = `${source.name} (copy)`;
  const slug = await makeUniqueSlug(name, (candidate) => slugExists(candidate));

  let sku = suffixSku(source.sku);
  // Vanishingly unlikely, but keep trying until the random suffix is free.
  while (await skuTaken(sku)) {
    sku = suffixSku(source.sku);
  }

  const row = await prisma.product.create({
    data: {
      categoryId: source.categoryId,
      name,
      slug,
      sku,
      brand: source.brand,
      brandId: source.brandRef?.id,
      description: source.description,
      specs: (source.specs ?? undefined) as Prisma.InputJsonValue | undefined,
      price: source.price,
      mrp: source.mrp,
      moq: source.moq,
      stockStatus: source.stockStatus,
      status: "INACTIVE",
      tags: source.tags,
      // Preserve the GST overrides on the clone (non-monetary metadata).
      hsnCode: source.hsnCode ?? null,
      gstRateBps: source.gstRateBps ?? null,
      taxTreatment: source.taxTreatment ?? null,
      images: source.images.map((image) => ({
        url: image.url,
        thumbUrl: image.thumbUrl ?? undefined,
        sortOrder: image.sortOrder,
        isPrimary: image.isPrimary,
      })),
    },
    select: PRICED_SELECT,
  });
  return toPricedProduct(row);
}

/* ------------------------------------------------------------------ */
/* setProductStatus / soft-delete / restore                           */
/* ------------------------------------------------------------------ */

/** Flips a product between ACTIVE and INACTIVE. */
export async function setProductStatus(
  id: string,
  status: EntityStatus,
): Promise<PricedProduct> {
  await findByIdOrThrow(id);
  const row = await prisma.product.update({
    where: { id },
    data: { status },
    select: PRICED_SELECT,
  });
  return toPricedProduct(row);
}

/**
 * Soft-deletes a product by stamping `deletedAt`. The row is retained (for the
 * Trash view and audit trail) but excluded from every storefront and default
 * admin read. Idempotent: re-deleting refreshes the timestamp.
 */
export async function softDeleteProduct(id: string): Promise<PricedProduct> {
  await findByIdOrThrow(id);
  const row = await prisma.product.update({
    where: { id },
    data: { deletedAt: new Date() },
    select: PRICED_SELECT,
  });
  return toPricedProduct(row);
}

/** Restores a soft-deleted product by clearing `deletedAt`. */
export async function restoreProduct(id: string): Promise<PricedProduct> {
  await findByIdOrThrow(id);
  const row = await prisma.product.update({
    where: { id },
    data: { deletedAt: null },
    select: PRICED_SELECT,
  });
  return toPricedProduct(row);
}
