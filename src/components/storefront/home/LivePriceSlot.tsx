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
 * their product ids with the surrounding <HomePriceReveal>, which makes ONE
 * batched fetch to /api/price-labels. Entitlement is resolved server-side in
 * that route — an unentitled viewer gets `{}` back and the anon pills simply
 * never change, so the logged-out experience is pixel-identical to the cached
 * shell. An entitled viewer's pills swap to the real label.
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

/**
 * Kept as a component so the page's structure is unchanged, but it no longer
 * owns a fetch or a context: each LivePriceSlot registers its own product id
 * with the shared per-viewer request, which batches every id on the page into
 * ONE call alongside the other slices. See viewer-context-client.
 */
export function HomePriceReveal({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
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
}: {
  productId: string;
  children: React.ReactNode;
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
    <span
      data-slot="price-pill"
      data-variant="default"
      className="inline-flex h-6 w-fit shrink-0 items-center rounded-full border border-border bg-secondary px-2 font-tabular text-xs font-semibold text-secondary-foreground"
    >
      {label}
    </span>
  );
}
