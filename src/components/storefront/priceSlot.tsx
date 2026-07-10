import * as React from "react";

import { PriceGateCard } from "@/components/storefront/PriceGateCard";
import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import type { ViewerContext } from "@/server/types/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";

/**
 * Server-side price-slot builder — the render half of the storefront price
 * gate, co-located with the listing grid.
 *
 * It resolves the authoritative gate verdict server-side (`canSeePrices`) and
 * the customer's status (for gated copy) and hands both to {@link PriceGateCard}
 * — the single price-gate control. PriceGateCard renders either the animated
 * PriceReveal (only for a price-authorised viewer holding a PricedProduct) or a
 * locked "See price" chip whose tap opens the RequestAccessSheet (for anon
 * viewers) / a status reason (for pending/expired/rejected/blocked customers).
 *
 * SAFETY: `canSeePrices(viewer)` is computed here on the server and passed as an
 * authoritative boolean. For any non-authorised viewer the DAL already handed us
 * a PublicProduct with NO price fields, so no amount can cross into the client.
 * PriceGateCard also refuses to read a price unless `canSeePrices` is true —
 * defence-in-depth, not the sole guard.
 */

export function renderPriceSlot(
  product: PublicProduct | PricedProduct,
  viewer: ViewerContext,
  size: "sm" | "md" | "lg" = "sm",
): React.ReactNode {
  return (
    <PriceGateCard
      product={product}
      canSeePrices={canSeePrices(viewer)}
      status={isCustomer(viewer) ? viewer.status : undefined}
      size={size}
      // Dense listing grids (size "sm") skip the count-up for smoother scroll;
      // larger single-price contexts keep the animated reveal.
      animate={size !== "sm"}
    />
  );
}
