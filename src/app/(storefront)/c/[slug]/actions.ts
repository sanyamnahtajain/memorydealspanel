"use server";

import { PAGE_SIZES } from "@/lib/constants";
import { getViewer } from "@/server/auth/viewer";
import { listByCategoryForViewer } from "@/server/dal/products";
import { renderPriceSlot } from "@/components/storefront/priceSlot";
import type { ProductCardItem } from "@/components/storefront/ProductCardGrid";

/**
 * Load one more page of a category's products for the CURRENT viewer, already
 * projected through the price gate (each card's `priceSlot` is rendered server
 * side, so no money ever crosses into the client for a gated viewer).
 *
 * Bound to a categoryId at the call site on the server component; the client
 * grid only passes the next page number.
 */
export async function loadMoreCategoryProducts(
  categoryId: string,
  nextPage: number,
): Promise<ProductCardItem[]> {
  const page = Math.max(1, Math.trunc(nextPage));
  const viewer = await getViewer();
  const products = await listByCategoryForViewer(viewer, categoryId, {
    page,
    take: PAGE_SIZES.storefront,
  });
  return products.map((product) => ({
    product,
    priceSlot: renderPriceSlot(product, viewer),
  }));
}
