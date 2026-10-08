"use client";

/**
 * FeaturedRail — the home page's product rails ("Best sellers", "New &
 * featured").
 *
 * PRICE-GATE CONTRACT: like {@link ProductCardGrid}, this client component never
 * receives raw money. Each item's `priceSlot` is a server-rendered node (a
 * PriceReveal for approved viewers, a locked chip otherwise, or null for a
 * price-free shelf) produced by `renderPriceSlot`. On the ISR home shell the
 * slots are rendered for the anonymous viewer, so they are always locked —
 * correct for a shared cache.
 *
 * On desktop it lays out as a responsive grid; on narrow screens it becomes a
 * snap-scrolling horizontal rail — the next card peeking in from the right
 * edge so the overflow reads as "more", not "cut off". Entrance is staggered
 * and honours reduced-motion. The card itself is the shared {@link ProductCard}.
 */

import * as React from "react";
import { motion, type Variants } from "motion/react";

import type { ProductCardItem } from "@/components/storefront/ProductCardGrid";
import { ProductCard } from "@/components/storefront/product/ProductCard";
import { useEntranceInitial } from "@/components/motion/useEntrance";

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 420, damping: 34 },
  },
};

/**
 * How many leading cards load their image eagerly with high fetch priority —
 * the rail sits near the top of the home page, so its first cards are LCP
 * candidates on phones.
 */
const PRIORITY_IMAGE_COUNT = 4;

export function FeaturedRail({
  items,
  priorityImageCount = PRIORITY_IMAGE_COUNT,
}: {
  items: ProductCardItem[];
  /**
   * How many leading cards get eager, high-priority images. Defaults to the
   * LCP-friendly count for a rail near the top of the page; pass 0 for a rail
   * that sits far below the fold (e.g. "New & featured" now that "Best
   * sellers" is the first rail on home).
   */
  priorityImageCount?: number;
}) {
  const entranceInitial = useEntranceInitial("hidden" as const);

  return (
    <motion.ul
      // Phones: a full-bleed snap rail (-mx-4 + scroll padding keeps the first
      // card on the page gutter) whose columns are sized so the next card
      // always peeks. sm+: a plain grid.
      className="no-scrollbar -mx-4 grid snap-x snap-mandatory auto-cols-[min(42vw,11.5rem)] grid-flow-col gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 sm:mx-0 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-3 sm:overflow-visible sm:px-0 md:gap-4 lg:grid-cols-4"
      variants={containerVariants}
      initial={entranceInitial}
      animate="show"
    >
      {items.map((item, index) => (
        <motion.li
          key={item.product.id}
          variants={itemVariants}
          className="snap-start"
        >
          <ProductCard
            product={item.product}
            priceSlot={item.priceSlot}
            priorityImage={index < priorityImageCount}
            // Two home rails can show the same product; a duplicated
            // view-transition-name would cancel the morph, so home cards opt
            // out of the seam and simply cross-fade into the detail page.
            transitionSeam={false}
            showSnippet={false}
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 42vw"
          />
        </motion.li>
      ))}
    </motion.ul>
  );
}
