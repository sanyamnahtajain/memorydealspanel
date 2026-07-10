"use server";

import { PAGE_SIZES } from "@/lib/constants";
import { getViewer } from "@/server/auth/viewer";
import { listByCategoryForViewer } from "@/server/dal/products";
import {
  buildListingItems,
  type ListingItem,
} from "@/components/storefront/listing";

/**
 * Load one more page of a category's products for the CURRENT viewer, already
 * projected through the price gate (each item's `priceSlot` is rendered server
 * side, and `priceSortKey` is attached ONLY for approved viewers), so no money
 * ever crosses into the client for a gated viewer.
 *
 * Bound to a categoryId at the call site on the server component; the client
 * listing only passes the next page number. The DAL returns its default
 * newest-first order; the client re-orders/filters the accumulated set.
 */
export async function loadMoreCategoryProducts(
  categoryId: string,
  nextPage: number,
): Promise<ListingItem[]> {
  const page = Math.max(1, Math.trunc(nextPage));
  const viewer = await getViewer();
  const products = await listByCategoryForViewer(viewer, categoryId, {
    page,
    take: PAGE_SIZES.storefront,
  });
  return buildListingItems(products, viewer);
}
