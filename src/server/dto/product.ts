import type { Prisma, ProductImage } from "@prisma/client";
import type { EntityStatus, StockStatus } from "@/lib/schemas/shared";

/**
 * Product DTOs — the serialization half of the price gate.
 *
 * `PublicProduct` is what an unauthorised viewer (anon, pending, expired,
 * blocked, or a rejected customer) is allowed to see. It has NO `price`,
 * `mrp`, or `marginPct` fields — not merely `undefined`, but structurally
 * absent, so `"price" in dto` is `false`. Because these mappers copy an
 * explicit allow-list of fields (never `{ ...raw }`), a price value can
 * never leak by accident even if a caller hands us a full Prisma row.
 *
 * `PricedProduct` extends the public shape with the money fields. It is only
 * ever produced for viewers where `canSeePrices(viewer)` is true (see
 * src/server/dal/products.ts). The DAL additionally uses a Mongo projection
 * so that, for non-priced viewers, the price never even enters Node.
 */

/** Public projection of a product image (identical shape, explicit copy). */
export interface PublicProductImage {
  url: string;
  thumbUrl: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

/**
 * Public projection of the referenced Brand master. Brand data (name / slug)
 * is PUBLIC — it carries no pricing — so it appears on `PublicProduct` too.
 * `null` when the product references no brand.
 */
export interface PublicProductBrand {
  id: string;
  name: string;
  slug: string;
}

/**
 * A product without any pricing information. This is the DEFAULT return
 * shape of the DAL — prices are opt-in and gated.
 */
export interface PublicProduct {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  sku: string;
  /** Legacy free-text brand string (back-compat). Prefer `brand.name`. */
  brand: string | null;
  /** The referenced Brand master (PUBLIC — no price). Null when unset. */
  brandRef: PublicProductBrand | null;
  description: string | null;
  specs: unknown;
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
  tags: string[];
  images: PublicProductImage[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A product WITH pricing. All money is integer paise (see src/lib/money.ts).
 * `marginPct` is a derived, rounded whole-number percentage of margin over
 * the selling price ((mrp - price) / mrp), present only when an `mrp` exists.
 */
export interface PricedProduct extends PublicProduct {
  /** Selling price in integer paise. */
  price: number;
  /** Maximum retail price in integer paise, when set. */
  mrp: number | null;
  /** Whole-number discount margin percentage vs. mrp, when mrp is set. */
  marginPct: number | null;
}

/**
 * The subset of Prisma `Product` fields the public mapper reads, defined
 * structurally so that either a projected row (no price/mrp) OR a full row
 * satisfies it. Money fields are optional and never read here.
 */
export interface PublicSource {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  sku: string;
  brand: string | null;
  /**
   * The joined Brand relation. `null` when `brandId` is unset. Only these
   * three PUBLIC fields are ever selected in the DAL — never any price.
   */
  brandRef?: { id: string; name: string; slug: string } | null;
  description: string | null;
  specs: Prisma.JsonValue;
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
  tags: string[];
  images: ProductImage[];
  createdAt: Date;
  updatedAt: Date;
  price?: number;
  mrp?: number | null;
}

/** The fields the priced mapper additionally requires. */
export interface PricedSource extends PublicSource {
  price: number;
  mrp?: number | null;
}

function toPublicImages(images: ProductImage[]): PublicProductImage[] {
  return images.map((image) => ({
    url: image.url,
    thumbUrl: image.thumbUrl ?? null,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
  }));
}

/**
 * Maps a Prisma product row to a `PublicProduct`, copying an explicit
 * allow-list of fields. Price fields are NEVER read here, so even a full
 * row cannot leak money through this mapper.
 */
export function toPublicProduct(row: PublicSource): PublicProduct {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    brand: row.brand ?? null,
    brandRef: row.brandRef
      ? { id: row.brandRef.id, name: row.brandRef.name, slug: row.brandRef.slug }
      : null,
    description: row.description ?? null,
    specs: row.specs ?? null,
    moq: row.moq ?? null,
    stockStatus: row.stockStatus,
    status: row.status,
    tags: row.tags ?? [],
    images: toPublicImages(row.images ?? []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Derives a whole-number discount percentage of `price` against `mrp`. */
function deriveMarginPct(price: number, mrp: number | null | undefined): number | null {
  if (mrp === null || mrp === undefined || mrp <= 0 || mrp <= price) {
    return null;
  }
  return Math.round(((mrp - price) / mrp) * 100);
}

/**
 * Maps a Prisma product row to a `PricedProduct`, layering the money fields
 * onto the public projection. Only ever called for price-authorised viewers.
 */
export function toPricedProduct(row: PricedSource): PricedProduct {
  const price = row.price;
  const mrp = row.mrp ?? null;
  return {
    ...toPublicProduct(row),
    price,
    mrp,
    marginPct: deriveMarginPct(price, mrp),
  };
}
