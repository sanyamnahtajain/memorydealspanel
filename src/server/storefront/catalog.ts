import "server-only";

import { PAGE_SIZES } from "@/lib/constants";
import { getViewer } from "@/server/auth/viewer";
import {
  listForViewer,
  listByCategoryForViewer,
} from "@/server/dal/products";
import type { PublicProduct } from "@/server/dto/product";

/**
 * Storefront catalog read helpers layered on top of the viewer-aware DAL.
 *
 * The DAL exposes page/take listing and per-category listing but no text
 * search, so search is implemented here by scanning viewer-projected pages
 * (the catalog is small) and matching on PUBLIC fields only. Every product
 * that leaves this module is whatever the DAL returned for the current
 * viewer — a `PublicProduct` for anon/pending/expired viewers and a
 * `PricedProduct` for approved customers / admins — so the price gate is
 * never bypassed here.
 */

/** Upper bound on rows scanned for an in-memory search pass. */
const SEARCH_SCAN_LIMIT = PAGE_SIZES.max;

export interface SearchResult {
  /** Products matching the query, ordered by relevance then recency. */
  items: PublicProduct[];
  /** The normalized query that was executed. */
  query: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function haystack(product: PublicProduct): string {
  const specValues =
    product.specs && typeof product.specs === "object"
      ? Object.values(product.specs as Record<string, unknown>)
          .filter((v): v is string | number => typeof v === "string" || typeof v === "number")
          .map(String)
      : [];
  return [
    product.name,
    product.brand ?? "",
    product.sku,
    product.tags.join(" "),
    specValues.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Ranks a product against the query terms. Higher is better; 0 = no match.
 * A name-start match outranks a name-substring match, which outranks a
 * brand/spec/tag match.
 */
function score(product: PublicProduct, terms: string[]): number {
  const name = product.name.toLowerCase();
  const brand = (product.brand ?? "").toLowerCase();
  const bag = haystack(product);
  let total = 0;
  for (const term of terms) {
    if (!bag.includes(term)) {
      return 0; // every term must appear somewhere (AND semantics)
    }
    if (name.startsWith(term)) total += 6;
    else if (name.includes(term)) total += 4;
    else if (brand.includes(term)) total += 2;
    else total += 1;
  }
  return total;
}

/**
 * Full-text-ish search over the storefront catalog for the CURRENT viewer.
 * Returns viewer-projected products (priced only for authorised viewers).
 */
export async function searchCatalog(rawQuery: string): Promise<SearchResult> {
  const query = normalize(rawQuery);
  if (query.length === 0) {
    return { items: [], query: "" };
  }
  const terms = query.split(/\s+/).filter(Boolean);
  const viewer = await getViewer();
  const pool = await listForViewer(viewer, { take: SEARCH_SCAN_LIMIT });

  const ranked = pool
    .map((product) => ({ product, rank: score(product, terms) }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      return b.product.createdAt.getTime() - a.product.createdAt.getTime();
    })
    .map((entry) => entry.product);

  return { items: ranked, query };
}

export interface CategoryPage {
  items: PublicProduct[];
  /** The distinct set of brands present across the category (for filters). */
  brands: string[];
}

/**
 * One page of a category's products for the current viewer, plus the brand
 * facet used by the filter chips. Brands are derived from the full first
 * scan of the category (small catalog) so the chip set is stable.
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
