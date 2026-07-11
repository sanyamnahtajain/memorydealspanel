"use server";

import { PAGE_SIZES } from "@/lib/constants";
import { getViewer } from "@/server/auth/viewer";
import { listByBrandForViewer } from "@/server/dal/brands";
import {
  buildListingItems,
  type ListingItem,
} from "@/components/storefront/listing";

/**
 * Load one more page of a brand's products for the CURRENT viewer, already
 * projected through the price gate (each item's `priceSlot` is server-rendered,
 * and `priceSortKey` is attached ONLY for approved viewers), so no money ever
 * crosses into the client for a gated viewer.
 *
 * Bound to a brandId at the call site on the server component; the client
 * listing only passes the next page number.
 */
export async function loadMoreBrandProducts(
  brandId: string,
  nextPage: number,
): Promise<ListingItem[]> {
  const page = Math.max(1, Math.trunc(nextPage));
  const viewer = await getViewer();
  const products = await listByBrandForViewer(viewer, brandId, {
    page,
    take: PAGE_SIZES.storefront,
  });
  return buildListingItems(products, viewer);
}
