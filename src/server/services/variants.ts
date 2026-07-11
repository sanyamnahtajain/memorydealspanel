import type { Prisma, ProductImage } from "@prisma/client";
import { prisma } from "@/server/db";
import { slugify } from "@/lib/slug";
import type { EntityStatus, StockStatus } from "@/lib/schemas/shared";
import type { ProductImageInput } from "@/lib/schemas/product";
import {
  createVariantSchema,
  optionTypesSchema,
  updateVariantSchema,
  type CreateVariantInput,
  type OptionTypesInput,
  type OptionValues,
  type UpdateVariantInput,
} from "@/lib/schemas/variant";

/**
 * Product-variant service layer (PRD Phase 11).
 *
 * Owns every variant mutation and the invariants that keep the catalog
 * backward-compatible:
 *
 *  - Variants are OPT-IN. `enableVariants` flips `Product.hasVariants` on (and
 *    seeds the first variant from the base product). `disableVariants` flips it
 *    off. While `hasVariants` is false the product behaves EXACTLY as before —
 *    this module writes no `ProductVariant` rows for such products.
 *  - When `hasVariants` is true, `Product.price`/`mrp`/`stockStatus` are the
 *    denormalized "FROM" facet (min ACTIVE variant price, its mrp, best stock)
 *    so listing/sort/gated reads keep working unchanged. `recomputeFrom` keeps
 *    them in sync after EVERY variant change.
 *  - SKUs are globally unique (across products AND variants, case-insensitive).
 *  - No two variants of a product may share the same option combination.
 *  - Variant price is integer paise > 0 (validated by schemas/variant).
 *
 * Authorisation (assertAdmin) and audit logging live in the ACTION layer
 * (src/server/actions/variants.ts) — this module is pure domain logic so it
 * stays unit-testable against the seeded DB without a session.
 */

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type VariantServiceErrorCode =
  | "PRODUCT_NOT_FOUND"
  | "VARIANT_NOT_FOUND"
  | "DUPLICATE_SKU"
  | "DUPLICATE_COMBO"
  | "INVALID_OPTION_VALUES"
  | "NO_OPTION_TYPES"
  | "INVALID_PRICE"
  | "NOT_A_VARIANT_PRODUCT";

/** Expected, recoverable failure carrying a stable `code` for the action layer. */
export class VariantServiceError extends Error {
  readonly code: VariantServiceErrorCode;

  constructor(code: VariantServiceErrorCode, message: string) {
    super(message);
    this.name = "VariantServiceError";
    this.code = code;
    Object.setPrototypeOf(this, VariantServiceError.prototype);
  }
}

export function isVariantServiceError(
  error: unknown,
): error is VariantServiceError {
  return error instanceof VariantServiceError;
}

/* ------------------------------------------------------------------ */
/* Selects / DTO shapes                                                */
/* ------------------------------------------------------------------ */

/** Admin (priced) variant projection. Prices always present for the editor. */
const VARIANT_SELECT = {
  id: true,
  productId: true,
  sku: true,
  optionValues: true,
  price: true,
  mrp: true,
  moq: true,
  stockStatus: true,
  status: true,
  images: true,
  isDefault: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductVariantSelect;

/**
 * Admin-facing variant row (priced). This is NOT the gated storefront DTO —
 * that lives in src/server/dto (owned separately) and strips price for
 * unauthorised viewers. Services only ever run for admins, so they return the
 * full priced shape.
 */
export interface AdminVariant {
  id: string;
  productId: string;
  sku: string;
  optionValues: OptionValues;
  price: number;
  mrp: number | null;
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
  images: {
    url: string;
    thumbUrl: string | null;
    sortOrder: number;
    isPrimary: boolean;
  }[];
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

type VariantRow = Prisma.ProductVariantGetPayload<{
  select: typeof VARIANT_SELECT;
}>;

function toAdminVariant(row: VariantRow): AdminVariant {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    optionValues: (row.optionValues ?? {}) as OptionValues,
    price: row.price,
    mrp: row.mrp ?? null,
    moq: row.moq ?? null,
    stockStatus: row.stockStatus,
    status: row.status,
    images: (row.images ?? []).map((image: ProductImage) => ({
      url: image.url,
      thumbUrl: image.thumbUrl ?? null,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

type ProductForVariants = {
  id: string;
  name: string;
  sku: string;
  price: number;
  mrp: number | null;
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
  hasVariants: boolean;
  optionTypes: Prisma.JsonValue;
};

async function loadProductOrThrow(productId: string): Promise<ProductForVariants> {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      sku: true,
      price: true,
      mrp: true,
      moq: true,
      stockStatus: true,
      status: true,
      hasVariants: true,
      optionTypes: true,
    },
  });
  if (!row) {
    throw new VariantServiceError("PRODUCT_NOT_FOUND", "Product not found.");
  }
  return row;
}

/** Parses the persisted `optionTypes` JSON into the validated shape (or []). */
function parseOptionTypes(raw: Prisma.JsonValue): OptionTypesInput {
  if (raw == null) return [];
  const result = optionTypesSchema.safeParse(raw);
  return result.success ? result.data : [];
}

/**
 * True when another product OR variant already uses this SKU (case-insensitive).
 * SKUs are globally unique across both namespaces so a variant never collides
 * with a base product SKU. `excludeVariantId` lets an update skip its own row.
 */
async function skuTakenGlobally(
  sku: string,
  excludeVariantId?: string,
): Promise<boolean> {
  const [product, variant] = await Promise.all([
    prisma.product.findFirst({
      where: { sku: { equals: sku, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.productVariant.findFirst({
      where: {
        sku: { equals: sku, mode: "insensitive" },
        ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
      },
      select: { id: true },
    }),
  ]);
  return product !== null || variant !== null;
}

/** A stable, order-independent key for a combination of option values. */
function comboKey(values: OptionValues): string {
  return Object.keys(values)
    .sort()
    .map((k) => `${k.toLowerCase()}=${String(values[k]).toLowerCase()}`)
    .join("|");
}

/**
 * Validates that `optionValues` covers EXACTLY the product's declared axes,
 * with each value drawn from that axis's declared value list. Returns the
 * values normalised to the canonical axis names/values from `optionTypes`.
 */
function normaliseOptionValues(
  optionTypes: OptionTypesInput,
  values: OptionValues,
): OptionValues {
  if (optionTypes.length === 0) {
    throw new VariantServiceError(
      "NO_OPTION_TYPES",
      "Define at least one option type before adding variants.",
    );
  }
  const provided = Object.keys(values);
  if (provided.length !== optionTypes.length) {
    throw new VariantServiceError(
      "INVALID_OPTION_VALUES",
      "A variant must specify exactly one value for each option.",
    );
  }
  const normalised: OptionValues = {};
  for (const axis of optionTypes) {
    // Match the axis name case-insensitively against the provided keys.
    const key = provided.find(
      (p) => p.toLowerCase() === axis.name.toLowerCase(),
    );
    if (key === undefined) {
      throw new VariantServiceError(
        "INVALID_OPTION_VALUES",
        `Missing a value for option "${axis.name}".`,
      );
    }
    const raw = String(values[key]);
    const match = axis.values.find(
      (v) => v.toLowerCase() === raw.toLowerCase(),
    );
    if (match === undefined) {
      throw new VariantServiceError(
        "INVALID_OPTION_VALUES",
        `"${raw}" is not a valid value for option "${axis.name}".`,
      );
    }
    normalised[axis.name] = match;
  }
  return normalised;
}

/** Enumerates the cartesian product of the option axes, in declared order. */
function enumerateCombos(optionTypes: OptionTypesInput): OptionValues[] {
  return optionTypes.reduce<OptionValues[]>(
    (acc, axis) =>
      acc.flatMap((combo) =>
        axis.values.map((value) => ({ ...combo, [axis.name]: value })),
      ),
    [{}],
  );
}

/** Suggests a SKU: baseSku + '-' + slugged option values (in axis order). */
function suggestSku(
  baseSku: string,
  optionTypes: OptionTypesInput,
  values: OptionValues,
): string {
  const parts = optionTypes.map((axis) => slugify(String(values[axis.name])));
  return [baseSku, ...parts].filter(Boolean).join("-").slice(0, 64);
}

/** Ensures a suggested SKU is globally free, appending a numeric suffix if not. */
async function uniqueSuggestedSku(base: string): Promise<string> {
  const root = (base || "variant").slice(0, 64);
  if (!(await skuTakenGlobally(root))) return root;
  for (let n = 2; n <= 999; n += 1) {
    const candidate = `${root}-${n}`.slice(0, 64);
    if (!(await skuTakenGlobally(candidate))) return candidate;
  }
  // Pathological: fall back to a random suffix.
  for (;;) {
    const candidate = `${root}-${Math.random().toString(36).slice(2, 6)}`.slice(
      0,
      64,
    );
    if (!(await skuTakenGlobally(candidate))) return candidate;
  }
}

function normaliseImages(
  images: ProductImageInput[],
): Prisma.ProductImageCreateInput[] {
  if (images.length === 0) return [];
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

/**
 * RECOMPUTE the denormalized "FROM" facet on the parent product from its
 * variants, and keep `hasVariants` in sync. This is the invariant that keeps
 * the existing catalog (listing / sort / gated FROM price) correct.
 *
 *  - FROM price = min ACTIVE variant price. (mrp = that same variant's mrp.)
 *  - stockStatus = the BEST stock across ACTIVE variants
 *    (IN_STOCK > LOW > OUT_OF_STOCK).
 *  - When there are no ACTIVE variants, fall back to any variant (so a product
 *    mid-setup still has a sane FROM), and OUT_OF_STOCK stock.
 *  - Ensures exactly one `isDefault` variant (the min-price active one).
 *  - When a product has variants but `hasVariants` is false, this does NOT
 *    force it on — enable/disable own that flag. It only syncs price/stock for
 *    products that ARE variant products.
 */
async function recomputeFrom(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, hasVariants: true },
  });
  if (!product || !product.hasVariants) return;

  const variants = await prisma.productVariant.findMany({
    where: { productId },
    select: {
      id: true,
      price: true,
      mrp: true,
      moq: true,
      status: true,
      stockStatus: true,
      isDefault: true,
    },
    orderBy: [{ price: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
  });
  if (variants.length === 0) return;

  const active = variants.filter((v) => v.status === "ACTIVE");
  const pricePool = active.length > 0 ? active : variants;

  // Min-price row drives the FROM price/mrp/moq and becomes the default.
  const fromRow = pricePool.reduce((min, v) => (v.price < min.price ? v : min));

  const stockRank: Record<StockStatus, number> = {
    IN_STOCK: 2,
    LOW: 1,
    OUT_OF_STOCK: 0,
  };
  const bestStock: StockStatus =
    active.length === 0
      ? "OUT_OF_STOCK"
      : active.reduce<StockStatus>(
          (best, v) =>
            stockRank[v.stockStatus] > stockRank[best] ? v.stockStatus : best,
          "OUT_OF_STOCK",
        );

  await prisma.product.update({
    where: { id: productId },
    data: {
      price: fromRow.price,
      mrp: fromRow.mrp ?? null,
      moq: fromRow.moq ?? null,
      stockStatus: bestStock,
    },
  });

  // Exactly one default variant: the FROM row. Only rewrite rows that differ.
  await Promise.all(
    variants.map((v) => {
      const shouldBeDefault = v.id === fromRow.id;
      if (v.isDefault === shouldBeDefault) return Promise.resolve();
      return prisma.productVariant.update({
        where: { id: v.id },
        data: { isDefault: shouldBeDefault },
      });
    }),
  );
}

async function getVariantOrThrow(variantId: string): Promise<VariantRow> {
  const row = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: VARIANT_SELECT,
  });
  if (!row) {
    throw new VariantServiceError("VARIANT_NOT_FOUND", "Variant not found.");
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* setOptionTypes                                                      */
/* ------------------------------------------------------------------ */

/**
 * Persists the option-type axis definitions on a product. Does not create any
 * variant rows — call `generateMatrix` for that. Validates the axes (distinct
 * names, distinct non-empty values).
 */
export async function setOptionTypes(
  productId: string,
  optionTypes: OptionTypesInput,
): Promise<OptionTypesInput> {
  await loadProductOrThrow(productId);
  const parsed = optionTypesSchema.parse(optionTypes);
  await prisma.product.update({
    where: { id: productId },
    data: { optionTypes: parsed as unknown as Prisma.InputJsonValue },
  });
  return parsed;
}

/* ------------------------------------------------------------------ */
/* generateMatrix                                                      */
/* ------------------------------------------------------------------ */

/**
 * Reconciles `ProductVariant` rows to exactly the cartesian product of the
 * product's `optionTypes`:
 *
 *  - keeps existing rows whose combo is still valid (untouched),
 *  - removes orphaned rows whose combo no longer exists,
 *  - adds a row for every new combo, with a suggested unique SKU and the base
 *    product's price/mrp/moq/stock as sensible starting values.
 *
 * Idempotent: re-running with the same option types is a no-op. Recomputes the
 * FROM facet afterward.
 */
export async function generateMatrix(productId: string): Promise<AdminVariant[]> {
  const product = await loadProductOrThrow(productId);
  const optionTypes = parseOptionTypes(product.optionTypes);
  if (optionTypes.length === 0) {
    throw new VariantServiceError(
      "NO_OPTION_TYPES",
      "Define at least one option type before generating variants.",
    );
  }

  const combos = enumerateCombos(optionTypes);
  const wanted = new Map(combos.map((c) => [comboKey(c), c]));

  const existing = await prisma.productVariant.findMany({
    where: { productId },
    select: { id: true, optionValues: true },
  });

  const existingKeys = new Set<string>();
  const orphanIds: string[] = [];
  for (const row of existing) {
    const values = (row.optionValues ?? {}) as OptionValues;
    const key = comboKey(values);
    if (wanted.has(key)) {
      existingKeys.add(key);
    } else {
      orphanIds.push(row.id);
    }
  }

  if (orphanIds.length > 0) {
    await prisma.productVariant.deleteMany({ where: { id: { in: orphanIds } } });
  }

  let sortOrder = existing.length - orphanIds.length;
  for (const combo of combos) {
    if (existingKeys.has(comboKey(combo))) continue;
    const sku = await uniqueSuggestedSku(
      suggestSku(product.sku, optionTypes, combo),
    );
    await prisma.productVariant.create({
      data: {
        productId,
        sku,
        optionValues: combo as unknown as Prisma.InputJsonValue,
        price: product.price,
        mrp: product.mrp ?? undefined,
        moq: product.moq ?? undefined,
        stockStatus: product.stockStatus,
        status: "ACTIVE",
        isDefault: false,
        sortOrder: sortOrder++,
      },
    });
  }

  await recomputeFrom(productId);
  return listVariants(productId);
}

/* ------------------------------------------------------------------ */
/* upsertVariant                                                       */
/* ------------------------------------------------------------------ */

/**
 * Creates or updates a single variant. On create, `optionValues` are validated
 * against the product's axes and must not duplicate an existing combo; a SKU is
 * auto-suggested when omitted. On update, only provided fields change. SKUs are
 * checked for global uniqueness. Recomputes the FROM facet afterward.
 */
export async function upsertVariant(
  productId: string,
  input: CreateVariantInput | (UpdateVariantInput & { id?: string }),
): Promise<AdminVariant> {
  const product = await loadProductOrThrow(productId);
  if (!product.hasVariants) {
    throw new VariantServiceError(
      "NOT_A_VARIANT_PRODUCT",
      "Enable variants on this product before adding variants.",
    );
  }
  const optionTypes = parseOptionTypes(product.optionTypes);

  const variantId = "id" in input ? input.id : undefined;

  if (variantId) {
    /* ---- update path ---- */
    const existing = await getVariantOrThrow(variantId);
    if (existing.productId !== productId) {
      throw new VariantServiceError(
        "VARIANT_NOT_FOUND",
        "Variant does not belong to this product.",
      );
    }
    const data = updateVariantSchema.parse(input);

    if (data.sku !== undefined && data.sku !== existing.sku) {
      if (await skuTakenGlobally(data.sku, variantId)) {
        throw new VariantServiceError(
          "DUPLICATE_SKU",
          `SKU "${data.sku}" is already in use.`,
        );
      }
    }

    let nextValues: OptionValues | undefined;
    if (data.optionValues !== undefined) {
      nextValues = normaliseOptionValues(optionTypes, data.optionValues);
      const key = comboKey(nextValues);
      const siblings = await prisma.productVariant.findMany({
        where: { productId, id: { not: variantId } },
        select: { optionValues: true },
      });
      if (
        siblings.some(
          (s) => comboKey((s.optionValues ?? {}) as OptionValues) === key,
        )
      ) {
        throw new VariantServiceError(
          "DUPLICATE_COMBO",
          "Another variant already uses this option combination.",
        );
      }
    }

    const nextPrice = data.price ?? existing.price;
    const nextMrp =
      data.mrp !== undefined ? data.mrp : existing.mrp ?? undefined;
    if (nextMrp !== undefined && nextMrp !== null && nextMrp < nextPrice) {
      throw new VariantServiceError(
        "INVALID_PRICE",
        "MRP must be greater than or equal to price.",
      );
    }

    const update: Prisma.ProductVariantUpdateInput = {};
    if (data.sku !== undefined) update.sku = data.sku;
    if (nextValues !== undefined) {
      update.optionValues = nextValues as unknown as Prisma.InputJsonValue;
    }
    if (data.price !== undefined) update.price = data.price;
    if (data.mrp !== undefined) update.mrp = data.mrp;
    if (data.moq !== undefined) update.moq = data.moq;
    if (data.stockStatus !== undefined) update.stockStatus = data.stockStatus;
    if (data.status !== undefined) update.status = data.status;
    if (data.sortOrder !== undefined) update.sortOrder = data.sortOrder;
    if (data.images !== undefined) {
      update.images = normaliseImages(data.images);
    }

    await prisma.productVariant.update({
      where: { id: variantId },
      data: update,
    });
    await recomputeFrom(productId);
    const fresh = await getVariantOrThrow(variantId);
    return toAdminVariant(fresh);
  }

  /* ---- create path ---- */
  const data = createVariantSchema.parse(input);
  const values = normaliseOptionValues(optionTypes, data.optionValues);

  const key = comboKey(values);
  const siblings = await prisma.productVariant.findMany({
    where: { productId },
    select: { optionValues: true },
  });
  if (
    siblings.some(
      (s) => comboKey((s.optionValues ?? {}) as OptionValues) === key,
    )
  ) {
    throw new VariantServiceError(
      "DUPLICATE_COMBO",
      "Another variant already uses this option combination.",
    );
  }

  const sku = data.sku
    ? data.sku
    : await uniqueSuggestedSku(suggestSku(product.sku, optionTypes, values));
  if (await skuTakenGlobally(sku)) {
    throw new VariantServiceError(
      "DUPLICATE_SKU",
      `SKU "${sku}" is already in use.`,
    );
  }

  const created = await prisma.productVariant.create({
    data: {
      productId,
      sku,
      optionValues: values as unknown as Prisma.InputJsonValue,
      price: data.price,
      mrp: data.mrp ?? undefined,
      moq: data.moq ?? undefined,
      stockStatus: data.stockStatus,
      status: data.status,
      isDefault: data.isDefault,
      sortOrder: data.sortOrder,
      images: normaliseImages(data.images),
    },
    select: VARIANT_SELECT,
  });
  await recomputeFrom(productId);
  return toAdminVariant(created);
}

/* ------------------------------------------------------------------ */
/* deleteVariant / setDefaultVariant / setVariantStatus               */
/* ------------------------------------------------------------------ */

/** Removes a single variant, then recomputes the FROM facet. */
export async function deleteVariant(variantId: string): Promise<void> {
  const existing = await getVariantOrThrow(variantId);
  await prisma.productVariant.delete({ where: { id: variantId } });
  await recomputeFrom(existing.productId);
}

/** Marks one variant as the default; clears the flag on its siblings. */
export async function setDefaultVariant(
  variantId: string,
): Promise<AdminVariant> {
  const existing = await getVariantOrThrow(variantId);
  await prisma.productVariant.updateMany({
    where: { productId: existing.productId, id: { not: variantId } },
    data: { isDefault: false },
  });
  await prisma.productVariant.update({
    where: { id: variantId },
    data: { isDefault: true },
  });
  const fresh = await getVariantOrThrow(variantId);
  return toAdminVariant(fresh);
}

/** Flips a variant between ACTIVE and INACTIVE, then recomputes the FROM facet. */
export async function setVariantStatus(
  variantId: string,
  status: EntityStatus,
): Promise<AdminVariant> {
  const existing = await getVariantOrThrow(variantId);
  await prisma.productVariant.update({
    where: { id: variantId },
    data: { status },
  });
  await recomputeFrom(existing.productId);
  const fresh = await getVariantOrThrow(variantId);
  return toAdminVariant(fresh);
}

/* ------------------------------------------------------------------ */
/* enableVariants / disableVariants                                    */
/* ------------------------------------------------------------------ */

/**
 * Turns a product INTO a variant product. Sets `hasVariants=true` and, if it
 * has no variants yet, seeds ONE variant from the base product (so it renders
 * and edits identically to before). Recomputes the FROM facet.
 *
 * Requires `optionTypes` to be defined (the seed variant needs a combo). If
 * none are set, define them via `setOptionTypes` first.
 */
export async function enableVariants(productId: string): Promise<void> {
  const product = await loadProductOrThrow(productId);
  if (product.hasVariants) return;

  const optionTypes = parseOptionTypes(product.optionTypes);
  if (optionTypes.length === 0) {
    throw new VariantServiceError(
      "NO_OPTION_TYPES",
      "Define at least one option type before enabling variants.",
    );
  }

  await prisma.product.update({
    where: { id: productId },
    data: { hasVariants: true },
  });

  const count = await prisma.productVariant.count({ where: { productId } });
  if (count === 0) {
    // Seed one variant from the base product using the FIRST value of each axis.
    const seedValues: OptionValues = {};
    for (const axis of optionTypes) {
      seedValues[axis.name] = axis.values[0];
    }
    const sku = await uniqueSuggestedSku(
      suggestSku(product.sku, optionTypes, seedValues),
    );
    await prisma.productVariant.create({
      data: {
        productId,
        sku,
        optionValues: seedValues as unknown as Prisma.InputJsonValue,
        price: product.price,
        mrp: product.mrp ?? undefined,
        moq: product.moq ?? undefined,
        stockStatus: product.stockStatus,
        status: "ACTIVE",
        isDefault: true,
        sortOrder: 0,
      },
    });
  }

  await recomputeFrom(productId);
}

/**
 * Turns a product back into a plain product. Sets `hasVariants=false` and
 * KEEPS `Product.price` (the last FROM price) so the catalog is undisturbed.
 * Variant rows are left in place (harmless while `hasVariants` is false) so
 * re-enabling restores them; callers that want a clean slate can generate anew.
 */
export async function disableVariants(productId: string): Promise<void> {
  const product = await loadProductOrThrow(productId);
  if (!product.hasVariants) return;
  await prisma.product.update({
    where: { id: productId },
    data: { hasVariants: false },
  });
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Lists a product's variants (admin/priced), in sort order. */
export async function listVariants(productId: string): Promise<AdminVariant[]> {
  const rows = await prisma.productVariant.findMany({
    where: { productId },
    select: VARIANT_SELECT,
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }, { id: "asc" }],
  });
  return rows.map(toAdminVariant);
}
