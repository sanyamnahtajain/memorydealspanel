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

/** A brand plus its count of visible products (price-free). */
export interface BrandWithCount extends PublicBrand {
  count: number;
}

/**
 * ACTIVE brands that have ≥1 visible (ACTIVE, non-deleted) product, each with
 * the product count. Ordered by count (desc) then name. Carries NO pricing —
 * counts + brand metadata are public — so it is safe on any surface.
 */
export async function listBrandsWithCounts(): Promise<BrandWithCount[]> {
  const [rows, grouped] = await Promise.all([
    prisma.brand.findMany({ where: { status: "ACTIVE" }, select: BRAND_SELECT }),
    prisma.product.groupBy({
      by: ["brandId"],
      where: { status: "ACTIVE", deletedAt: null, brandId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map(grouped.map((g) => [g.brandId, g._count._all]));
  return rows
    .map((r) => ({ ...toPublicBrand(r), count: counts.get(r.id) ?? 0 }))
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
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
  /** Restrict to a single category (for the brand → category → products drill-down). */
  categoryId?: string;
}

/** A category the brand has products in, with the (price-free) product count. */
export interface BrandCategory {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  count: number;
}

/**
 * Categories that have ≥1 visible (ACTIVE, non-deleted) product for this brand,
 * each with the product count. Carries NO pricing — counts and category
 * metadata are public — so it is safe on any surface. Ordered by the category's
 * own sortOrder then name.
 */
export async function listBrandCategories(
  brandId: string,
): Promise<BrandCategory[]> {
  const grouped = await prisma.product.groupBy({
    by: ["categoryId"],
    where: { ...VISIBLE_WHERE, brandId },
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];
  const counts = new Map(grouped.map((g) => [g.categoryId, g._count._all]));
  const cats = await prisma.category.findMany({
    where: { id: { in: grouped.map((g) => g.categoryId) }, status: "ACTIVE" },
    select: { id: true, name: true, slug: true, image: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return cats.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    image: c.image,
    count: counts.get(c.id) ?? 0,
  }));
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
  const where = {
    ...VISIBLE_WHERE,
    brandId,
    ...(options?.categoryId ? { categoryId: options.categoryId } : {}),
  } satisfies Prisma.ProductWhereInput;
  if (canSeePrices(viewer)) {
    const rows = await prisma.product.findMany({
      where,
      select: PRICED_PRODUCT_SELECT,
      orderBy: STOREFRONT_ORDER,
      skip,
      take,
    });
    return rows.map((row) => toPricedProduct(row));
  }
  const rows = await prisma.product.findMany({
    where,
    select: PUBLIC_PRODUCT_FIELDS,
    orderBy: STOREFRONT_ORDER,
    skip,
    take,
  });
  return rows.map((row) => toPublicProduct(row));
}
