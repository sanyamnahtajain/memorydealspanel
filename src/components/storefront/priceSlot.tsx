import * as React from "react";

import { PriceGateCard } from "@/components/storefront/PriceGateCard";
import { GstPriceLabel } from "@/components/storefront/GstPriceLabel";
import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import type { GstView } from "@/server/prefs/gst-view";
import type { ViewerContext } from "@/server/types/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";

/** Narrows a DTO to its priced form without trusting a leaked field. */
function hasPricedBreakdown(
  product: PublicProduct | PricedProduct,
): product is PricedProduct {
  return "taxBreakdown" in product;
}

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
  /**
   * The retailer's incl/excl display preference (from `getGstViewPreference()`).
   * Optional: when omitted the GST caption's wording simply follows the price's
   * effective treatment. Only affects wording, never the figure. Ignored while
   * the GST kill-switch is off (the caption renders nothing then anyway).
   */
  gstView?: GstView,
): React.ReactNode {
  const seePrices = canSeePrices(viewer);
  // The GST caption reads ONLY the non-monetary `product.tax` for every viewer;
  // the paise `taxBreakdown` is passed exclusively when the viewer is priced
  // (and only a PricedProduct structurally carries it). GstPriceLabel returns
  // null when GST is off, so gated / pre-GST slots render exactly as before.
  const breakdown =
    seePrices && hasPricedBreakdown(product) ? product.taxBreakdown : null;

  return (
    <div className="flex flex-col items-start gap-0.5">
      <PriceGateCard
        product={product}
        canSeePrices={seePrices}
        status={isCustomer(viewer) ? viewer.status : undefined}
        size={size}
        // Dense listing grids (size "sm") skip the count-up for smoother scroll;
        // larger single-price contexts keep the animated reveal.
        animate={size !== "sm"}
      />
      <GstPriceLabel
        tax={product.tax}
        breakdown={breakdown}
        view={gstView}
        size={size}
      />
    </div>
  );
}
