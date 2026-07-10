"use server";

import { getViewer } from "@/server/auth/viewer";
import { searchCatalog } from "@/server/storefront/catalog";
import {
  buildListingItems,
  type ListingItem,
} from "@/components/storefront/listing";

/**
 * A minimal, PRICE-FREE search suggestion for the instant-search overlay.
 * Deliberately omits every money field so nothing gated can ever reach the
 * client through the type-ahead — the overlay only needs enough to render a
 * result row and link to the product.
 */
export interface SearchSuggestion {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  thumbUrl: string | null;
}

/** Max suggestions returned to the overlay per keystroke. */
const SUGGESTION_LIMIT = 8;

/**
 * Server action for instant search. Returns viewer-agnostic PUBLIC fields
 * only (never a price), so it is safe to call from the client overlay for
 * any viewer.
 */
export async function searchSuggestions(
  query: string,
): Promise<SearchSuggestion[]> {
  const { items } = await searchCatalog(query);
  return items.slice(0, SUGGESTION_LIMIT).map((product) => {
    const primary =
      product.images.find((img) => img.isPrimary) ?? product.images[0] ?? null;
    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      brand: product.brand,
      thumbUrl: primary ? (primary.thumbUrl ?? primary.url) : null,
    };
  });
}

/**
 * Load one more page of full search results for the CURRENT viewer, projected
 * through the price gate (`priceSlot` is server-rendered here, and
 * `priceSortKey` is attached ONLY for approved viewers, so no money leaks into
 * the client for a gated viewer). Bound to the query on the server component;
 * the client listing only passes the next page number.
 */
export async function loadMoreSearchProducts(
  query: string,
  nextPage: number,
): Promise<ListingItem[]> {
  const { items } = await searchCatalog(query, Math.max(1, Math.trunc(nextPage)));
  const viewer = await getViewer();
  return buildListingItems(items, viewer);
}
