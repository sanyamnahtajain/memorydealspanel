import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { PAGE_SIZES } from "@/lib/constants";
import {
  canSeePrices,
  type ViewerContext,
} from "@/server/types/viewer";
import {
  toPricedProduct,
  toPublicProduct,
  type PricedProduct,
  type PublicProduct,
} from "@/server/dto/product";
import { assertAdmin } from "./guard";

/**
 * Viewer-aware product Data Access Layer — the read half of the price gate.
 *
 * Every storefront read takes a `ViewerContext` and returns `PublicProduct[]`
 * (no money fields) UNLESS `canSeePrices(viewer)` is true, in which case it
 * returns `PricedProduct[]`. For non-priced viewers we hand Mongo a `select`
 * projection that OMITS `price` and `mrp`, so the price never travels over the
 * wire into the Node process — defence in depth beyond the DTO mapper.
 *
 * TypeScript overloads narrow the return type on the concrete viewer kind at
 * the callsite where it is statically known (admin → priced), and fall back to
 * the union for a dynamic `ViewerContext`.
 */

/** Fields shared by both projections — everything except money. */
const PUBLIC_FIELDS = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  sku: true,
  brand: true,
  // Brand master join — PUBLIC fields only (id/name/slug). Adds NO price to
  // the payload, so this is safe for every viewer including anon.
  brandRef: { select: { id: true, name: true, slug: true } },
  description: true,
  specs: true,
  moq: true,
  stockStatus: true,
  status: true,
  tags: true,
  images: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

/** Projection with money — only ever used for price-authorised viewers. */
const PRICED_SELECT = {
  ...PUBLIC_FIELDS,
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

export interface ListForViewerOptions {
  /** 1-based page number. Defaults to 1. */
  page?: number;
  /** Page size; clamped to [1, PAGE_SIZES.max]. Defaults to storefront size. */
  take?: number;
}

function resolvePaging(options: ListForViewerOptions | undefined): {
  skip: number;
  take: number;
} {
  const page = Math.max(1, Math.trunc(options?.page ?? 1));
  const requested = Math.trunc(options?.take ?? PAGE_SIZES.storefront);
  const take = Math.min(PAGE_SIZES.max, Math.max(1, requested));
  return { skip: (page - 1) * take, take };
}

// ---------------------------------------------------------------------------
// listForViewer
// ---------------------------------------------------------------------------

export function listForViewer(
  viewer: import("@/server/types/viewer").AdminViewer,
  options?: ListForViewerOptions,
): Promise<PricedProduct[]>;
export function listForViewer(
  viewer: import("@/server/types/viewer").AnonViewer,
  options?: ListForViewerOptions,
): Promise<PublicProduct[]>;
export function listForViewer(
  viewer: ViewerContext,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]>;
export async function listForViewer(
  viewer: ViewerContext,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]> {
  const { skip, take } = resolvePaging(options);
  if (canSeePrices(viewer)) {
    const rows = await prisma.product.findMany({
      where: VISIBLE_WHERE,
      select: PRICED_SELECT,
      orderBy: STOREFRONT_ORDER,
      skip,
      take,
    });
    return rows.map(toPricedProduct);
  }
  const rows = await prisma.product.findMany({
    where: VISIBLE_WHERE,
    select: PUBLIC_FIELDS,
    orderBy: STOREFRONT_ORDER,
    skip,
    take,
  });
  return rows.map(toPublicProduct);
}

// ---------------------------------------------------------------------------
// getBySlugForViewer
// ---------------------------------------------------------------------------

export function getBySlugForViewer(
  viewer: import("@/server/types/viewer").AdminViewer,
  slug: string,
): Promise<PricedProduct | null>;
export function getBySlugForViewer(
  viewer: import("@/server/types/viewer").AnonViewer,
  slug: string,
): Promise<PublicProduct | null>;
export function getBySlugForViewer(
  viewer: ViewerContext,
  slug: string,
): Promise<PublicProduct | PricedProduct | null>;
export async function getBySlugForViewer(
  viewer: ViewerContext,
  slug: string,
): Promise<PublicProduct | PricedProduct | null> {
  if (canSeePrices(viewer)) {
    const row = await prisma.product.findFirst({
      where: { ...VISIBLE_WHERE, slug },
      select: PRICED_SELECT,
    });
    return row ? toPricedProduct(row) : null;
  }
  const row = await prisma.product.findFirst({
    where: { ...VISIBLE_WHERE, slug },
    select: PUBLIC_FIELDS,
  });
  return row ? toPublicProduct(row) : null;
}

// ---------------------------------------------------------------------------
// listByCategoryForViewer
// ---------------------------------------------------------------------------

export function listByCategoryForViewer(
  viewer: import("@/server/types/viewer").AdminViewer,
  categoryId: string,
  options?: ListForViewerOptions,
): Promise<PricedProduct[]>;
export function listByCategoryForViewer(
  viewer: import("@/server/types/viewer").AnonViewer,
  categoryId: string,
  options?: ListForViewerOptions,
): Promise<PublicProduct[]>;
export function listByCategoryForViewer(
  viewer: ViewerContext,
  categoryId: string,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]>;
export async function listByCategoryForViewer(
  viewer: ViewerContext,
  categoryId: string,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]> {
  const { skip, take } = resolvePaging(options);
  const where = { ...VISIBLE_WHERE, categoryId } satisfies Prisma.ProductWhereInput;
  if (canSeePrices(viewer)) {
    const rows = await prisma.product.findMany({
      where,
      select: PRICED_SELECT,
      orderBy: STOREFRONT_ORDER,
      skip,
      take,
    });
    return rows.map(toPricedProduct);
  }
  const rows = await prisma.product.findMany({
    where,
    select: PUBLIC_FIELDS,
    orderBy: STOREFRONT_ORDER,
    skip,
    take,
  });
  return rows.map(toPublicProduct);
}

// ---------------------------------------------------------------------------
// searchForViewer — text search pushed down to the database.
// ---------------------------------------------------------------------------

/**
 * Build the case-insensitive OR filter for a search over PUBLIC fields only
 * (name / sku / brand / tags). Never touches money, so it is safe for every
 * viewer. Empty / whitespace queries yield an empty filter (no OR).
 */
function searchWhere(query: string): Prisma.ProductWhereInput {
  const q = query.trim();
  if (q.length === 0) return VISIBLE_WHERE;
  const terms = q.split(/\s+/).filter(Boolean);
  // AND across terms, each term matching any public field (OR across fields).
  const and: Prisma.ProductWhereInput[] = terms.map((term) => ({
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      { sku: { contains: term, mode: "insensitive" } },
      { brand: { contains: term, mode: "insensitive" } },
      { brandRef: { name: { contains: term, mode: "insensitive" } } },
      { tags: { has: term } },
    ],
  }));
  return { ...VISIBLE_WHERE, AND: and };
}

export function searchForViewer(
  viewer: import("@/server/types/viewer").AdminViewer,
  query: string,
  options?: ListForViewerOptions,
): Promise<PricedProduct[]>;
export function searchForViewer(
  viewer: import("@/server/types/viewer").AnonViewer,
  query: string,
  options?: ListForViewerOptions,
): Promise<PublicProduct[]>;
export function searchForViewer(
  viewer: ViewerContext,
  query: string,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]>;
export async function searchForViewer(
  viewer: ViewerContext,
  query: string,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]> {
  const { skip, take } = resolvePaging(options);
  const where = searchWhere(query);
  if (canSeePrices(viewer)) {
    const rows = await prisma.product.findMany({
      where,
      select: PRICED_SELECT,
      orderBy: STOREFRONT_ORDER,
      skip,
      take,
    });
    return rows.map(toPricedProduct);
  }
  const rows = await prisma.product.findMany({
    where,
    select: PUBLIC_FIELDS,
    orderBy: STOREFRONT_ORDER,
    skip,
    take,
  });
  return rows.map(toPublicProduct);
}

/** Count products matching a search query (for pagination / result counts). */
export async function countSearchForViewer(query: string): Promise<number> {
  return prisma.product.count({ where: searchWhere(query) });
}

// ---------------------------------------------------------------------------
// listForAdminGrid — admin-only, always priced, includes soft-deleted &
// inactive rows for the DealSheet management view.
// ---------------------------------------------------------------------------

export interface AdminGridOptions extends ListForViewerOptions {
  /** Include soft-deleted rows (deletedAt != null). Defaults to false. */
  includeDeleted?: boolean;
}

/**
 * The full management grid: prices always present, and (unlike the storefront
 * reads) INACTIVE products are included. Throws `ForbiddenError` for any
 * non-admin viewer before touching the database.
 */
export async function listForAdminGrid(
  viewer: ViewerContext,
  options?: AdminGridOptions,
): Promise<PricedProduct[]> {
  assertAdmin(viewer);
  const { skip, take } = resolvePaging(options);
  const where: Prisma.ProductWhereInput = options?.includeDeleted
    ? {}
    : { deletedAt: null };
  const rows = await prisma.product.findMany({
    where,
    select: PRICED_SELECT,
    orderBy: STOREFRONT_ORDER,
    skip,
    take,
  });
  return rows.map(toPricedProduct);
}
