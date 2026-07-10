/**
 * Shared, PRICE-FREE types for the storefront search overlay.
 *
 * Nothing in this module carries money. The overlay's type-ahead only ever
 * receives public fields (name / brand / thumbnail), so it is safe to render
 * for any viewer — anon, pending, expired, or approved. Live, viewer-aware
 * pricing lives exclusively on the full `/search` results page, which reads
 * the gated DAL server-side.
 */

/** A category quick-chip shown when the query is empty. */
export interface CategoryChip {
  name: string;
  slug: string;
}

// Re-export the suggestion shape from the server action so overlay consumers
// have a single import surface for search types.
export type { SearchSuggestion } from "@/app/(storefront)/search/actions";
