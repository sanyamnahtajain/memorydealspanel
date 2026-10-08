"use client";

/**
 * LivePriceSlot / HomePriceReveal — client-side price upgrade for the PUBLIC
 * ISR home rails (Best sellers, Trending now).
 *
 * THE PROBLEM: home is a cached public shell (revalidate=300) whose rails are
 * server-rendered with ANON locked pills — correct for the cache, wrong to
 * leave standing for an approved customer looking at their own home screen.
 *
 * THE PATTERN (same contract as BuyAgainRail): the server-rendered anon pill
 * is the CHILDREN of each <LivePriceSlot>; after hydration the leaves register
 * their product ids with the shared per-viewer request, which makes ONE
 * batched fetch to /api/me/context. Entitlement is resolved server-side in
 * that route — an unentitled viewer gets `{}` back and the anon pills simply
 * never change, so the logged-out experience is pixel-identical to the cached
 * shell. An entitled viewer's pills swap to the real label.
 *
 * LATE RAILS: a rail that streams in through a Suspense boundary mounts its
 * slots AFTER the first batch has gone; viewer-context-client schedules a
 * follow-up request for just those ids (see its `run`).
 *
 * QUICK ADD: a label arriving is the server saying "this viewer may see
 * prices" — the same verdict that unlocks add-to-cart. When the caller passes
 * `quickAdd` (ids + quantity rules only), the priced state also shows the
 * one-tap QuickAddToCart beside the label; the add action re-checks access
 * server-side on every call. Gated viewers never see it, because they never
 * get a label.
 *
 * PRICE-GATE CONTRACT: nothing in this file computes entitlement or handles a
 * raw money number — labels arrive pre-formatted ("₹1,299") or not at all.
 */

import * as React from "react";

import {
  getViewerContext,
  needPriceLabel,
  subscribe,
} from "@/components/storefront/viewer-context-client";
import { QuickAddToCart } from "@/components/storefront/cart/QuickAddToCart";

/**
 * Kept as a component so the page's structure is unchanged, but it no longer
 * owns a fetch or a context: each LivePriceSlot registers its own product id
 * with the shared per-viewer request, which batches every id on the page into
 * ONE call alongside the other slices. See viewer-context-client.
 */
export function HomePriceReveal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export interface LivePriceSlotQuickAdd {
  moq: number | null;
  packMultiple: number | null;
}

/**
 * Wraps one card's server-rendered anon price slot. Until (unless) a label
 * arrives for this product, it renders the children untouched — zero visual
 * difference from the pure server shell. With a label it renders the priced
 * pill (the label is already formatted; no raw money reaches this file).
 */
export function LivePriceSlot({
  productId,
  children,
  quickAdd = null,
}: {
  productId: string;
  children: React.ReactNode;
  /**
   * Offer the one-tap add beside a LIVE label. Pass only for a plain, in-stock,
   * non-variant, non-allocation product (the caller knows the product; this
   * component knows only whether a label arrived). Carries no money.
   */
  quickAdd?: LivePriceSlotQuickAdd | null;
}) {
  const [label, setLabel] = React.useState<string | undefined>(
    () => getViewerContext().priceLabels[productId],
  );

  React.useEffect(() => {
    const update = () => setLabel(getViewerContext().priceLabels[productId]);
    const unsubscribe = subscribe(update);
    needPriceLabel(productId);
    update();
    return unsubscribe;
  }, [productId]);

  if (!label) return <>{children}</>;

  return (
    <span className="flex w-full items-end justify-between gap-2">
      <span className="flex min-w-0 flex-col">
        <span className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Wholesale
        </span>
        <span
          data-slot="live-price"
          className="font-tabular truncate text-[15px] font-semibold text-foreground"
        >
          {label}
        </span>
      </span>
      {quickAdd ? (
        <QuickAddToCart
          productId={productId}
          moq={quickAdd.moq}
          packMultiple={quickAdd.packMultiple}
          className="shrink-0"
        />
      ) : null}
    </span>
  );
}
