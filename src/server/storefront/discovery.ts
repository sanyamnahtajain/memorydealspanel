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
import { priceBandRange, type PriceBandId } from "@/server/dal/facets";
import type { StockStatus } from "@/lib/schemas/shared";

/**
 * Discovery orchestrator (PRD 7.7) — applies the full faceted-filter set to the
 * storefront catalogue for the CURRENT viewer, SERVER-SIDE, and returns a page
 * of viewer-projected products plus pagination metadata.
 *
 * The price gate is enforced two ways, in concert with the product DAL:
 *   1. Projection — gated viewers get a `select` that OMITS `price`/`mrp`, so a
 *      price never enters Node for them (defence in depth beyond the DTO).
 *   2. Filter/sort — the `priceBand` filter and the `price` sort are HONOURED
 *      ONLY when `canSeePrices(viewer)`. For anon/pending/expired viewers they
 *      are silently IGNORED: a client cannot use a price control to probe the
 *      catalogue, because the server refuses to apply it and never returns a
 *      price to compare against.
 *
 * All the non-price facets (category / brand / spec / stock / tags) are applied
 * for every viewer — they carry no money.
 *
 * Scale: filtering + sorting + a bounded `count` are all pushed to MongoDB;
 * pagination is cursor-based (stable createdAt+id) so deep pages don't degrade.
 */

/* ------------------------------------------------------------------ */
/* Field projections (mirror src/server/dal/products.ts)               */
/* ------------------------------------------------------------------ */

const PUBLIC_FIELDS = {
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
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

const PRICED_SELECT = {
  ...PUBLIC_FIELDS,
  price: true,
  mrp: true,
} satisfies Prisma.ProductSelect;

const VISIBLE_WHERE = {
  status: "ACTIVE",
  deletedAt: null,
} satisfies Prisma.ProductWhereInput;

/* ------------------------------------------------------------------ */
/* Filter / sort inputs                                                */
/* ------------------------------------------------------------------ */

/** One spec constraint: a spec key must equal one of these values (OR). */
export interface SpecFilter {
  key: string;
  values: string[];
}

/** Sort options. Price sorts are honoured ONLY for price-authorised viewers. */
export type DiscoverSort =
  | "newest"
  | "name-asc"
  | "name-desc"
  | "price-asc"
  | "price-desc";

export interface DiscoverParams {
  /** Restrict to a single category. */
  categoryId?: string;
  /** Restrict to a set of Brand master ids (OR). */
  brandIds?: string[];
  /** Spec constraints (AND across keys, OR within a key's values). */
  specFilters?: SpecFilter[];
  /** Restrict to a set of stock statuses (OR). */
  stock?: StockStatus[];
  /** Restrict to products carrying ALL of these tags. */
  tags?: string[];
  /** Free-text search over public fields (name / sku / brand / tags). */
  search?: string;
  /**
   * Preset price band. IGNORED unless the viewer may see prices — a gated
   * viewer's price-band selection has no effect (and no price is returned).
   */
  priceBand?: PriceBandId;
  /** Result ordering; price sorts fall back to `newest` for gated viewers. */
  sort?: DiscoverSort;
  /** Opaque forward cursor (a product id) from a previous page's `nextCursor`. */
  cursor?: string;
  /** Page size; clamped to [1, PAGE_SIZES.max]. */
  limit?: number;
}

export interface DiscoverResult {
  /** This page of products — priced only for authorised viewers. */
  items: (PublicProduct | PricedProduct)[];
  /** Cursor to pass as `cursor` for the next page, or null when exhausted. */
  nextCursor: string | null;
  /** Total matches across all pages for the applied filters. */
  total: number;
  /** Whether `priceBand` / price sort were honoured for this viewer. */
  priceApplied: boolean;
}

/* ------------------------------------------------------------------ */
/* Where builder — every clause here is PRICE-FREE except the gated    */
/* price-band, which is only ever added for authorised viewers.        */
/* ------------------------------------------------------------------ */

function searchClause(search: string): Prisma.ProductWhereInput[] {
  const q = search.trim();
  if (q.length === 0) return [];
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => ({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
        { brand: { contains: term, mode: "insensitive" } },
        { brandRef: { name: { contains: term, mode: "insensitive" } } },
        { tags: { has: term } },
      ] satisfies Prisma.ProductWhereInput[],
    }));
}

/**
 * Build the full filter. `allowPrice` gates the price-band clause: when false
 * (viewer may not see prices) the band is dropped entirely, so a gated caller's
 * price-band selection is a no-op rather than a leak.
 */
function buildWhere(
  params: DiscoverParams,
  allowPrice: boolean,
): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];

  if (params.categoryId) {
    and.push({ categoryId: params.categoryId });
  }
  if (params.brandIds && params.brandIds.length > 0) {
    and.push({ brandId: { in: params.brandIds } });
  }
  if (params.stock && params.stock.length > 0) {
    and.push({ stockStatus: { in: params.stock } });
  }
  if (params.tags && params.tags.length > 0) {
    // ALL tags required.
    for (const tag of params.tags) {
      and.push({ tags: { has: tag } });
    }
  }
  if (params.specFilters && params.specFilters.length > 0) {
    for (const spec of params.specFilters) {
      const values = spec.values.filter((v) => v.length > 0);
      if (values.length === 0) continue;
      // specs is JSON: match key -> one of values. Prisma Mongo JSON filter.
      and.push({
        OR: values.map((value) => ({
          specs: { path: [spec.key], equals: value },
        })),
      });
    }
  }
  if (params.search) {
    and.push(...searchClause(params.search));
  }

  // THE GATE: only apply the price band when the viewer may see prices.
  if (allowPrice && params.priceBand) {
    const range = priceBandRange(params.priceBand);
    if (range) {
      const price: Prisma.IntFilter = { gte: range.minPaise };
      if (range.maxPaise !== null) price.lt = range.maxPaise;
      and.push({ price });
    }
  }

  return and.length > 0 ? { ...VISIBLE_WHERE, AND: and } : { ...VISIBLE_WHERE };
}

/* ------------------------------------------------------------------ */
/* Sort builder                                                        */
/* ------------------------------------------------------------------ */

/**
 * Resolve the order-by list. Price sorts are honoured only when `allowPrice`;
 * otherwise they fall back to `newest`. `id: asc` is always appended as a
 * stable tiebreaker so cursor pagination is deterministic.
 */
function buildOrderBy(
  sort: DiscoverSort | undefined,
  allowPrice: boolean,
): Prisma.ProductOrderByWithRelationInput[] {
  const effective: DiscoverSort =
    (sort === "price-asc" || sort === "price-desc") && !allowPrice
      ? "newest"
      : sort ?? "newest";

  switch (effective) {
    case "name-asc":
      return [{ name: "asc" }, { id: "asc" }];
    case "name-desc":
      return [{ name: "desc" }, { id: "asc" }];
    case "price-asc":
      return [{ price: "asc" }, { id: "asc" }];
    case "price-desc":
      return [{ price: "desc" }, { id: "asc" }];
    case "newest":
    default:
      return [{ createdAt: "desc" }, { id: "asc" }];
  }
}

function resolveLimit(limit: number | undefined): number {
  const requested = Math.trunc(limit ?? PAGE_SIZES.storefront);
  return Math.min(PAGE_SIZES.max, Math.max(1, requested));
}

/* ------------------------------------------------------------------ */
/* discoverProducts                                                    */
/* ------------------------------------------------------------------ */

/**
 * Run a faceted discovery query for the current viewer. Returns gated
 * `PublicProduct[]` for anon/pending/expired viewers and `PricedProduct[]` for
 * approved customers / admins. `priceBand` and the two price sorts are ignored
 * for gated viewers (`priceApplied` reports which happened).
 */
export async function discoverProducts(
  viewer: ViewerContext,
  params: DiscoverParams = {},
): Promise<DiscoverResult> {
  const allowPrice = canSeePrices(viewer);
  const take = resolveLimit(params.limit);
  const where = buildWhere(params, allowPrice);
  const orderBy = buildOrderBy(params.sort, allowPrice);

  // Fetch one extra row to determine whether a further page exists, using a
  // stable cursor on product id (skip the cursor row itself). Keep both keys
  // present with a fixed shape so Prisma's findMany overload resolves cleanly.
  const cursorArgs: { cursor?: { id: string }; skip: number } = params.cursor
    ? { cursor: { id: params.cursor }, skip: 1 }
    : { skip: 0 };

  const priceApplied =
    allowPrice &&
    (Boolean(params.priceBand) ||
      params.sort === "price-asc" ||
      params.sort === "price-desc");

  if (allowPrice) {
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: PRICED_SELECT,
        orderBy,
        take: take + 1,
        ...cursorArgs,
      }),
      prisma.product.count({ where }),
    ]);
    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    return {
      items: page.map((row) => toPricedProduct(row)),
      nextCursor: hasMore ? page[page.length - 1]!.id : null,
      total,
      priceApplied,
    };
  }

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: PUBLIC_FIELDS,
      orderBy,
      take: take + 1,
      ...cursorArgs,
    }),
    prisma.product.count({ where }),
  ]);
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  return {
    items: page.map((row) => toPublicProduct(row)),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
    total,
    priceApplied: false,
  };
}
