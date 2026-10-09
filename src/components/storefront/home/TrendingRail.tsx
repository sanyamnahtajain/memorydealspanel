import * as React from "react";

import { trendingProductIds } from "@/server/services/recommendations";
import { listByIdsForViewer } from "@/server/dal/products";
import { ANON_VIEWER } from "@/server/types/viewer";
import { renderPriceSlot } from "@/components/storefront/priceSlot";
import {
  LivePriceSlot,
  type LivePriceSlotQuickAdd,
} from "@/components/storefront/home/LivePriceSlot";
import { ProductCard } from "@/components/storefront/product/ProductCard";
import { SectionHeading } from "@/components/storefront/home/SectionHeading";
import { Rail } from "@/components/storefront/Rail";
import type { PublicProduct, PricedProduct } from "@/server/dto/product";

/**
 * TrendingRail — the self-contained "Trending now" section for the home page.
 *
 * A SERVER component on purpose, so it is ISR-safe on the public home shell:
 *  - it reads NO cookies and branches on NO viewer — products are resolved for
 *    the ANONYMOUS viewer via the gated DAL, exactly like the featured rail;
 *  - PRICE GATE: the trending score and this component's props never carry
 *    money. Every price cell is a server-rendered `renderPriceSlot(product,
 *    ANON_VIEWER)` node — a locked "See price" chip on the shared cache,
 *    correct for every visitor. LivePriceSlot upgrades it client-side for an
 *    entitled viewer (labels come only from the server route).
 *
 * Ranking comes from `trendingProductIds` (admin pins first, then the surge
 * algorithm — see src/lib/trending.ts). Renders NOTHING when there is no
 * signal, so a quiet week never shows an empty shelf.
 *
 * Presentation follows the house section pattern (eyebrow, bold title) over a
 * CSS scroll-snap horizontal rail of the shared ProductCard.
 */

/** Rail length — matches the featured rail's 8 so the shelves feel alike. */
const TRENDING_LIMIT = 8;

interface TrendingItem {
  product: PublicProduct | PricedProduct;
  priceSlot: React.ReactNode;
}

/**
 * Quick-add rules for a card — ONLY for a plain product whose add is a single
 * tap (in stock, no variants to pick, no allocation builder). The control
 * itself appears only once a live label has arrived for the viewer.
 */
function quickAddFor(product: PublicProduct): LivePriceSlotQuickAdd | null {
  if (product.hasVariants) return null;
  if (product.allocation?.required) return null;
  if (product.stockStatus === "OUT_OF_STOCK") return null;
  return { moq: product.moq, packMultiple: product.packMultiple };
}

export async function TrendingRail() {
  const ids = await trendingProductIds(TRENDING_LIMIT);
  if (ids.length === 0) return null;

  // The DAL keeps the ranked order and silently drops hidden/deleted ids.
  const products = await listByIdsForViewer(ANON_VIEWER, ids);
  if (products.length === 0) return null;

  const items: TrendingItem[] = products.map((product) => ({
    product,
    // Anon pill in the cached shell; when the page mounts this inside
    // <HomePriceReveal>, entitled viewers get the real label client-side.
    priceSlot: (
      <LivePriceSlot productId={product.id} quickAdd={quickAddFor(product)}>
        {renderPriceSlot(product, ANON_VIEWER)}
      </LivePriceSlot>
    ),
  }));

  return (
    <section aria-labelledby="home-trending">
      {/* The shared house header; the flame rides in the subtitle. */}
      <SectionHeading
        id="home-trending"
        title="Trending now"
        subtitle="What shops are opening most this week."
      />

      {/* Rail adds the laptop affordances (arrows, edge fade); the list itself
          stays pure CSS scroll-snap, so phones get a thumb gesture and nothing
          else to download. Full-bleed on phones with the next card peeking. */}
      <Rail
        ariaLabel="Trending products"
        className="-mx-4 md:mx-0"
        listClassName="no-scrollbar grid snap-x snap-mandatory auto-cols-[min(42vw,11.5rem)] grid-flow-col gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 md:auto-cols-[minmax(11rem,13rem)] md:gap-4 md:scroll-px-0 md:px-0"
      >
        {items.map((item) => (
          <li key={item.product.id} className="snap-start">
            <ProductCard
              product={item.product}
              priceSlot={item.priceSlot}
              // Same product may sit in Best sellers too — no seam on home.
              transitionSeam={false}
              showSnippet={false}
              sizes="(min-width: 768px) 13rem, 42vw"
            />
          </li>
        ))}
      </Rail>
    </section>
  );
}
