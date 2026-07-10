"use server";

import { searchCatalog } from "@/server/storefront/catalog";

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
