import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { PAGE_SIZES } from "@/lib/constants";
import { canSeePrices, type ViewerContext } from "@/server/types/viewer";
import {
  toPricedProduct,
  toPublicProduct,
  type PricedProduct,
  type PublicProduct,
} from "@/server/dto/product";

/**
 * Brand DAL — the PUBLIC read half of the Brand master.
 *
 * Brand data (name, slug, logo) carries NO pricing, so — like categories —
 * there is no price gate on the brand record itself. The brand-scoped PRODUCT
 * reads, however, are fully viewer-gated: they mirror the projection in
 * src/server/dal/products.ts so a non-priced viewer never receives `price`/`mrp`
 * (the money fields are omitted from the Mongo `select`, defence in depth beyond
 * the DTO mapper). Only ACTIVE brands are visible on the storefront — an
 * INACTIVE brand is treated as non-existent, exactly like a hidden category.
 */

/** Serialized public brand shape (explicit allow-list — never any price). */
export interface PublicBrand {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
}

const BRAND_SELECT = {
  id: true,
  name: true,
  slug: true,
  logo: true,
} satisfies Prisma.BrandSelect;

/** Storefront ordering: explicit sortOrder first, then name for stability. */
const BRAND_ORDER: Prisma.BrandOrderByWithRelationInput[] = [
  { sortOrder: "asc" },
  { name: "asc" },
];

type BrandRow = Prisma.BrandGetPayload<{ select: typeof BRAND_SELECT }>;

function toPublicBrand(row: BrandRow): PublicBrand {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo ?? null,
  };
}

/** All ACTIVE brands, ordered for storefront navigation / directories. */
export async function listActivePublicBrands(): Promise<PublicBrand[]> {
  const rows = await prisma.brand.findMany({
    where: { status: "ACTIVE" },
    select: BRAND_SELECT,
    orderBy: BRAND_ORDER,
  });
  return rows.map(toPublicBrand);
}

/**
 * A single ACTIVE brand by slug, or null. Inactive brands are treated as
 * non-existent for the storefront (so their landing page 404s).
 */
export async function getBrandBySlug(slug: string): Promise<PublicBrand | null> {
  const row = await prisma.brand.findFirst({
    where: { slug, status: "ACTIVE" },
    select: BRAND_SELECT,
  });
  return row ? toPublicBrand(row) : null;
}

/* ------------------------------------------------------------------ */
/* Brand-scoped product reads (viewer-gated — the price gate lives here) */
/* ------------------------------------------------------------------ */

/** Fields shared by both projections — everything except money. */
const PUBLIC_PRODUCT_FIELDS = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  sku: true,
  brand: true,
  description: true,
  specs: true,
  moq: true,
  stockStatus: true,
  status: true,
  tags: true,
  images: true,
  brandRef: { select: { id: true, name: true, slug: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

/** Projection WITH money — only ever used for price-authorised viewers. */
const PRICED_PRODUCT_SELECT = {
  ...PUBLIC_PRODUCT_FIELDS,
  price: true,
  mrp: true,
} satisfies Prisma.ProductSelect;

/** Only active, non-soft-deleted products are visible on the storefront. */
const VISIBLE_WHERE = {
  status: "ACTIVE",
  deletedAt: null,
} satisfies Prisma.ProductWhereInput;

/** Deterministic storefront ordering: newest first, stable by id. */
const STOREFRONT_ORDER: Prisma.ProductOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "asc" },
];

export interface ListByBrandOptions {
  /** 1-based page number. Defaults to 1. */
  page?: number;
  /** Page size; clamped to [1, PAGE_SIZES.max]. Defaults to storefront size. */
  take?: number;
}

function resolvePaging(options: ListByBrandOptions | undefined): {
  skip: number;
  take: number;
} {
  const page = Math.max(1, Math.trunc(options?.page ?? 1));
  const requested = Math.trunc(options?.take ?? PAGE_SIZES.storefront);
  const take = Math.min(PAGE_SIZES.max, Math.max(1, requested));
  return { skip: (page - 1) * take, take };
}

/**
 * Products belonging to a brand (by brandId), viewer-gated. Returns
 * `PublicProduct[]` (no money) unless `canSeePrices(viewer)` is true, in which
 * case `PricedProduct[]`. For gated viewers the money fields are projected away
 * at the database boundary so a price never enters Node — identical to the
 * product DAL's guarantee.
 */
export function listByBrandForViewer(
  viewer: import("@/server/types/viewer").AdminViewer,
  brandId: string,
  options?: ListByBrandOptions,
): Promise<PricedProduct[]>;
export function listByBrandForViewer(
  viewer: import("@/server/types/viewer").AnonViewer,
  brandId: string,
  options?: ListByBrandOptions,
): Promise<PublicProduct[]>;
export function listByBrandForViewer(
  viewer: ViewerContext,
  brandId: string,
  options?: ListByBrandOptions,
): Promise<(PublicProduct | PricedProduct)[]>;
export async function listByBrandForViewer(
  viewer: ViewerContext,
  brandId: string,
  options?: ListByBrandOptions,
): Promise<(PublicProduct | PricedProduct)[]> {
  const { skip, take } = resolvePaging(options);
  const where = { ...VISIBLE_WHERE, brandId } satisfies Prisma.ProductWhereInput;
  if (canSeePrices(viewer)) {
    const rows = await prisma.product.findMany({
      where,
      select: PRICED_PRODUCT_SELECT,
      orderBy: STOREFRONT_ORDER,
      skip,
      take,
    });
    return rows.map(toPricedProduct);
  }
  const rows = await prisma.product.findMany({
    where,
    select: PUBLIC_PRODUCT_FIELDS,
    orderBy: STOREFRONT_ORDER,
    skip,
    take,
  });
  return rows.map(toPublicProduct);
}
