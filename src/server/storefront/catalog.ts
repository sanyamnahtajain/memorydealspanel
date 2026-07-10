import "server-only";

import { PAGE_SIZES } from "@/lib/constants";
import { getViewer } from "@/server/auth/viewer";
import {
  listByCategoryForViewer,
  searchForViewer,
  countSearchForViewer,
} from "@/server/dal/products";
import type { PublicProduct } from "@/server/dto/product";

/**
 * Storefront catalog read helpers layered on top of the viewer-aware DAL.
 *
 * Text search is pushed DOWN to the database via `searchForViewer` (a
 * case-insensitive OR over PUBLIC fields — name / sku / brand / tags — with
 * skip/take), so large catalogs never load a 100-row page into memory just to
 * filter it. Every product that leaves this module is whatever the DAL
 * returned for the current viewer — a `PublicProduct` for anon/pending/expired
 * viewers and a `PricedProduct` for approved customers / admins — so the price
 * gate is never bypassed here.
 */

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export interface SearchResult {
  /** Products matching the query for this page, newest first. */
  items: PublicProduct[];
  /** The normalized query that was executed. */
  query: string;
  /** Total number of matches across all pages. */
  total: number;
  /** 1-based page returned. */
  page: number;
  /** Whether another page of matches exists after this one. */
  hasMore: boolean;
}

/**
 * Full-text-ish search over the storefront catalog for the CURRENT viewer,
 * paginated at the database level. Returns viewer-projected products (priced
 * only for authorised viewers). `page` is 1-based.
 */
export async function searchCatalog(
  rawQuery: string,
  page = 1,
): Promise<SearchResult> {
  const query = normalize(rawQuery);
  if (query.length === 0) {
    return { items: [], query: "", total: 0, page: 1, hasMore: false };
  }
  const safePage = Math.max(1, Math.trunc(page));
  const viewer = await getViewer();
  const [items, total] = await Promise.all([
    searchForViewer(viewer, query, {
      page: safePage,
      take: PAGE_SIZES.storefront,
    }),
    // Only need the total on the first page (used for the results count).
    safePage === 1 ? countSearchForViewer(query) : Promise.resolve(0),
  ]);

  const hasMore = items.length === PAGE_SIZES.storefront;
  return { items, query, total, page: safePage, hasMore };
}

export interface CategoryPage {
  items: PublicProduct[];
  /** The distinct set of brands present across the category (for filters). */
  brands: string[];
}

/**
 * One page of a category's products for the current viewer, plus the brand
 * facet used by the filter chips. Brands are derived from the returned page;
 * callers that need the full facet set should derive it from the first page
 * (small catalog) — `CategoryFilters` treats the chip set as best-effort.
 */
export async function loadCategoryPage(
  categoryId: string,
  page: number,
): Promise<CategoryPage> {
  const viewer = await getViewer();
  const items = await listByCategoryForViewer(viewer, categoryId, {
    page,
    take: PAGE_SIZES.storefront,
  });
  const brands = Array.from(
    new Set(items.map((p) => p.brand).filter((b): b is string => Boolean(b))),
  ).sort((a, b) => a.localeCompare(b));
  return { items, brands };
}
