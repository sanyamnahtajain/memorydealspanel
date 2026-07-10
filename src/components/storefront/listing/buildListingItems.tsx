import "server-only";

import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import type { ViewerContext } from "@/server/types/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { renderPriceSlot } from "@/components/storefront/priceSlot";
import type { ListingItem } from "./types";

/**
 * Server-side builder for {@link ListingItem}s — the ONLY place that turns the
 * DAL's viewer-projected products into the listing's client-safe items.
 *
 * For each product it renders the price slot on the SERVER (the real price for
 * an approved viewer, the locked PriceGate chip otherwise), so no amount ever
 * crosses into the client for a gated viewer. It attaches a `priceSortKey`
 * (integer paise) ONLY when the viewer is price-authorised AND the product
 * actually carries a price — the client uses it purely for ordering, and an
 * approved viewer can already see every price, so this does not widen the gate.
 *
 * Non-approved viewers get items with NO `priceSortKey`, and the DTO they hold
 * (`PublicProduct`) structurally has no money field at all.
 */
export function buildListingItems(
  products: (PublicProduct | PricedProduct)[],
  viewer: ViewerContext,
): ListingItem[] {
  const priced = canSeePrices(viewer);
  return products.map((product) => {
    const item: ListingItem = {
      product,
      priceSlot: renderPriceSlot(product, viewer),
    };
    if (priced && "price" in product && typeof product.price === "number") {
      item.priceSortKey = product.price;
    }
    return item;
  });
}
