import { Prisma } from "@prisma/client";
import {
  termVariants,
  categoryNameMatchesQuery,
} from "@/lib/search-normalize";
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
  packMultiple: true,
  stockStatus: true,
  status: true,
  tags: true,
  images: true,
  createdAt: true,
  updatedAt: true,
  // NON-MONETARY boolean: the listing card needs to know a product has
  // variants to offer the quick-pick sheet. The DAL's list selects carry it
  // too — this select is discovery's OWN, and missing it here was exactly the
  // kind of drift that only shows up in a real browser: the DAL had the
  // field, the DTO mapped it, and every storefront row still said false.
  hasVariants: true,
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
  /**
   * Restrict to a set of category ids (OR). ADDITIVE (context-scoped filters):
   * used by the brand page's category chips. ANDs with every other clause —
   * combining it with `categoryId` narrows to their intersection.
   */
  categoryIds?: string[];
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
  /**
   * Whether to run the `count` alongside the page (default true). Load-more
   * callers pass `false` — the first page already told the client the total,
   * and re-counting on every appended page is a wasted query (a full scan
   * under a search where-clause). When false, `total` is returned as -1 and
   * MUST NOT be rendered.
   */
  withTotal?: boolean;
  /** Page size; clamped to [1, PAGE_SIZES.max]. */
  limit?: number;
}

export interface DiscoverResult {
  /** This page of products — priced only for authorised viewers. */
  items: (PublicProduct | PricedProduct)[];
  /** Cursor to pass as `cursor` for the next page, or null when exhausted. */
  nextCursor: string | null;
  /**
   * Total matches across all pages for the applied filters — or -1 when the
   * caller passed `withTotal: false` (load-more pages never re-count).
   */
  total: number;
  /** Whether `priceBand` / price sort were honoured for this viewer. */
  priceApplied: boolean;
}

/* ------------------------------------------------------------------ */
/* Where builder — every clause here is PRICE-FREE except the gated    */
/* price-band, which is only ever added for authorised viewers.        */
/* ------------------------------------------------------------------ */

/**
 * Free-text matcher, forgiving by design (owner request): every term matches
 * in singular AND plural spellings, and — when the query canonically names a
 * category ("power bank" / "power banks" / "powerbanks" ⇔ "Power Banks") —
 * the WHOLE category matches too, surfacing products whose titles never
 * carry the words (e.g. "Ambrane 20000mAh").
 */
function searchClause(
  search: string,
  matchedCategoryIds: readonly string[],
): Prisma.ProductWhereInput[] {
  const q = search.trim();
  if (q.length === 0) return [];
  const and = q
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => ({
      OR: termVariants(term).flatMap((v) => [
        { name: { contains: v, mode: "insensitive" as const } },
        { sku: { contains: v, mode: "insensitive" as const } },
        { brand: { contains: v, mode: "insensitive" as const } },
        { brandRef: { name: { contains: v, mode: "insensitive" as const } } },
        { tags: { has: v } },
      ]) satisfies Prisma.ProductWhereInput[],
    }));
  if (matchedCategoryIds.length === 0) return and;
  // Field-match (all terms) OR category-match, as ONE composed clause so it
  // ANDs cleanly with the other filters (brand, stock, an explicit category…).
  return [{ OR: [{ AND: and }, { categoryId: { in: [...matchedCategoryIds] } }] }];
}

/**
 * Per-instance short-TTL cache of the ACTIVE category id+name list backing
 * {@link searchCategoryIds}. The read is tiny (dozens of rows) but ran on
 * EVERY discover call — including every search load-more. Category names
 * change rarely; a 60s memo (same pattern as the entry-gate settings cache)
 * removes the per-call round-trip. PRICE-FREE (ids + names only) and
 * viewer-independent, so one shared entry is safe for every gate class.
 */
const ACTIVE_CATEGORY_TTL_MS = 60_000;
let activeCategoryCache: {
  rows: { id: string; name: string }[];
  expiresAt: number;
} | null = null;

async function activeCategoryRows(): Promise<{ id: string; name: string }[]> {
  const now = Date.now();
  if (activeCategoryCache && activeCategoryCache.expiresAt > now) {
    return activeCategoryCache.rows;
  }
  const rows = await prisma.category.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true },
  });
  activeCategoryCache = { rows, expiresAt: now + ACTIVE_CATEGORY_TTL_MS };
  return rows;
}

/** TEST-ONLY: drop the category memo so a just-created category is seen. */
export function _resetActiveCategoryCacheForTests(): void {
  activeCategoryCache = null;
}

/**
 * The ACTIVE categories the query canonically names. Served from the 60s
 * per-instance memo above; empty for empty/short queries.
 */
async function searchCategoryIds(search: string | undefined): Promise<string[]> {
  const q = search?.trim() ?? "";
  if (q.length === 0) return [];
  const categories = await activeCategoryRows();
  return categories
    .filter((c) => categoryNameMatchesQuery(c.name, q))
    .map((c) => c.id);
}

/**
 * Build the full filter. `allowPrice` gates the price-band clause: when false
 * (viewer may not see prices) the band is dropped entirely, so a gated caller's
 * price-band selection is a no-op rather than a leak.
 */
function buildWhere(
  params: DiscoverParams,
  allowPrice: boolean,
  matchedCategoryIds: readonly string[] = [],
): Prisma.ProductWhereInput {
  const and: Prisma.ProductWhereInput[] = [];

  if (params.categoryId) {
    and.push({ categoryId: params.categoryId });
  }
  if (params.categoryIds && params.categoryIds.length > 0) {
    and.push({ categoryId: { in: params.categoryIds } });
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
    and.push(...searchClause(params.search, matchedCategoryIds));
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
  const where = buildWhere(params, allowPrice, await searchCategoryIds(params.search));
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

  const withTotal = params.withTotal !== false;

  if (allowPrice) {
    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: PRICED_SELECT,
        orderBy,
        take: take + 1,
        ...cursorArgs,
      }),
      withTotal ? prisma.product.count({ where }) : Promise.resolve(-1),
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
    withTotal ? prisma.product.count({ where }) : Promise.resolve(-1),
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

/* ------------------------------------------------------------------ */
/* Context-scoped facets (ADDITIVE — owner: "if i am on boat brand     */
/* page, why i am seeing filter for zebronics")                        */
/* ------------------------------------------------------------------ */

/**
 * One refinement available on a listing page, scoped to that page's context:
 * on a CATEGORY page these are the brands with visible products in the
 * category; on a BRAND page, the categories the brand actually stocks.
 * PRICE-FREE by construction — id, name, slug, count only.
 */
export interface ContextFacetItem {
  id: string;
  name: string;
  slug: string;
  count: number;
}

/**
 * PURE assembly step (unit-tested): join grouped product counts with their
 * master rows. Groups whose master is missing (deleted, or not ACTIVE — the
 * caller queries ACTIVE masters only) or whose count is zero are DROPPED, so
 * the facet never offers a refinement that would land on an empty page.
 * Sorted by count descending, then name, for a stable chip order.
 */
export function assembleContextFacets(
  grouped: ReadonlyArray<{ id: string | null; count: number }>,
  masters: ReadonlyArray<{ id: string; name: string; slug: string }>,
): ContextFacetItem[] {
  const masterById = new Map(masters.map((m) => [m.id, m]));
  const items: ContextFacetItem[] = [];
  for (const g of grouped) {
    if (g.id === null || g.count <= 0) continue;
    const master = masterById.get(g.id);
    if (!master) continue;
    items.push({ id: master.id, name: master.name, slug: master.slug, count: g.count });
  }
  return items.sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );
}

/**
 * Brands that actually have VISIBLE products in this category, with counts.
 * Backing for the category page's brand chips — a brand with nothing in the
 * category never appears. Bounded: an index-backed `groupBy` on `brandId`
 * plus one name lookup; never a row scan into Node. PRICE-FREE.
 */
export async function brandFacetsForCategory(
  categoryId: string,
): Promise<ContextFacetItem[]> {
  const grouped = await prisma.product.groupBy({
    by: ["brandId"],
    where: { ...VISIBLE_WHERE, categoryId, brandId: { not: null } },
    _count: { _all: true },
  });
  const ids = grouped
    .map((g) => g.brandId)
    .filter((id): id is string => id !== null);
  if (ids.length === 0) return [];
  const brands = await prisma.brand.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: { id: true, name: true, slug: true },
  });
  return assembleContextFacets(
    grouped.map((g) => ({ id: g.brandId, count: g._count._all })),
    brands,
  );
}

/**
 * Categories this brand actually has VISIBLE products in, with counts.
 * Backing for the brand page's category chips (a brand page NEVER shows a
 * brand facet — you are already inside one brand). Bounded groupBy + one
 * name lookup. PRICE-FREE.
 */
export async function categoryFacetsForBrand(
  brandId: string,
): Promise<ContextFacetItem[]> {
  const grouped = await prisma.product.groupBy({
    by: ["categoryId"],
    where: { ...VISIBLE_WHERE, brandId },
    _count: { _all: true },
  });
  if (grouped.length === 0) return [];
  const categories = await prisma.category.findMany({
    where: { id: { in: grouped.map((g) => g.categoryId) }, status: "ACTIVE" },
    select: { id: true, name: true, slug: true },
  });
  return assembleContextFacets(
    grouped.map((g) => ({ id: g.categoryId, count: g._count._all })),
    categories,
  );
}
