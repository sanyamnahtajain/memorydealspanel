import type { Prisma, ProductImage } from "@prisma/client";
import type { StockStatus } from "@/lib/schemas/shared";
import {
  toPublicImages,
  type PublicProductImage,
} from "./product";

/**
 * ProductVariant DTOs — the variant half of the price gate.
 *
 * A product can be OPT-IN split into purchasable variants (e.g.
 * "20000mAh · Black"). Each variant carries its own gated price/sku/stock.
 * The gate is identical to {@link PublicProduct}/{@link PricedProduct}:
 *
 *  - `PublicVariant` is what an unauthorised viewer (anon / pending / expired /
 *    rejected / blocked) is allowed to see. It has NO `price`, `mrp`, or
 *    `marginPct` — not merely `undefined`, but STRUCTURALLY ABSENT, so
 *    `"price" in dto` is `false`.
 *  - `PricedVariant` extends the public shape with the money fields. It is only
 *    ever produced for viewers where `canSeePrices(viewer)` is true.
 *
 * Both mappers copy an explicit allow-list of fields (never `{ ...raw }`), so a
 * variant price can never leak by accident even if a caller hands us a full
 * Prisma row. The DAL additionally uses a Mongo projection that OMITS the money
 * columns for non-priced viewers, so the amount never enters Node.
 */

/**
 * The chosen value per option axis, e.g. `{ Capacity: "20000mAh", Color:
 * "Black" }`. Keys correspond to `Product.optionTypes[].name`; values are one
 * of that axis's `values`. Stored as free-form JSON on the row.
 */
export type VariantOptionValues = Record<string, string>;

/** A variant without any pricing information — the DEFAULT / gated shape. */
export interface PublicVariant {
  id: string;
  sku: string;
  /** Chosen value per option axis (see {@link VariantOptionValues}). */
  optionValues: VariantOptionValues;
  stockStatus: StockStatus;
  /** Whether this is the product's default (pre-selected) variant. */
  isDefault: boolean;
  /** Stable ordering within the product's variant list. */
  sortOrder: number;
  /** Variant-specific images. Empty when the variant reuses product images. */
  images: PublicProductImage[];
}

/**
 * A variant WITH pricing. All money is integer paise (see src/lib/money.ts).
 * `marginPct` is a derived, rounded whole-number discount percentage vs. mrp,
 * present only when an `mrp` exists.
 */
export interface PricedVariant extends PublicVariant {
  /** Selling price in integer paise. */
  price: number;
  /** Maximum retail price in integer paise, when set. */
  mrp: number | null;
  /** Whole-number discount margin percentage vs. mrp, when mrp is set. */
  marginPct: number | null;
}

/**
 * The subset of Prisma `ProductVariant` fields the public mapper reads, defined
 * structurally so that either a projected row (no price/mrp) OR a full row
 * satisfies it. Money fields are optional and never read by the public mapper.
 */
export interface PublicVariantSource {
  id: string;
  sku: string;
  optionValues: Prisma.JsonValue;
  stockStatus: StockStatus;
  isDefault: boolean;
  sortOrder: number;
  images?: ProductImage[];
  price?: number;
  mrp?: number | null;
}

/** The fields the priced mapper additionally requires. */
export interface PricedVariantSource extends PublicVariantSource {
  price: number;
  mrp?: number | null;
}

/**
 * Coerces the free-form `optionValues` JSON to a string→string map, dropping
 * any non-string values defensively. Never throws.
 */
function toOptionValues(raw: Prisma.JsonValue): VariantOptionValues {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: VariantOptionValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Maps a Prisma variant row to a `PublicVariant`, copying an explicit
 * allow-list of fields. Price fields are NEVER read here, so even a full row
 * cannot leak money through this mapper.
 */
export function toPublicVariant(row: PublicVariantSource): PublicVariant {
  return {
    id: row.id,
    sku: row.sku,
    optionValues: toOptionValues(row.optionValues),
    stockStatus: row.stockStatus,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    images: toPublicImages(row.images ?? []),
  };
}

/** Derives a whole-number discount percentage of `price` against `mrp`. */
function deriveMarginPct(
  price: number,
  mrp: number | null | undefined,
): number | null {
  if (mrp === null || mrp === undefined || mrp <= 0 || mrp <= price) {
    return null;
  }
  return Math.round(((mrp - price) / mrp) * 100);
}

/**
 * Maps a Prisma variant row to a `PricedVariant`, layering the money fields
 * onto the public projection. Only ever called for price-authorised viewers.
 */
export function toPricedVariant(row: PricedVariantSource): PricedVariant {
  const price = row.price;
  const mrp = row.mrp ?? null;
  return {
    ...toPublicVariant(row),
    price,
    mrp,
    marginPct: deriveMarginPct(price, mrp),
  };
}
