"use client";

/**
 * ProductGridView — image-forward product cards.
 *
 * PRICE-GATE CONTRACT: each item carries a `product` ({@link
 * import("@/server/dto/product").PublicProduct} — no money) and a
 * server-rendered `priceSlot` node. This component only PLACES that node; it
 * never reads or formats a price. For a gated viewer the slot is the locked
 * PriceGate chip, so no amount reaches the client here.
 *
 * Pure renderer: pagination and filtering live in the parent
 * {@link import("./StorefrontListing").StorefrontListing}. The card is the
 * shared {@link ProductCard}; this file adds the listing-only controls (save
 * heart, in-cart chip, quick add, variant quick-pick).
 */

import * as React from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/utils";
import { staggerItemVariants } from "@/components/motion/primitives";
import { HeartButton } from "@/components/storefront/wishlist/HeartButton";
import { InCartChip } from "@/components/storefront/cart/InCartChip";
import { QuickAddToCart } from "@/components/storefront/cart/QuickAddToCart";
import { VariantQuickSheet } from "@/components/storefront/VariantQuickSheet";
import { ProductCard } from "@/components/storefront/product/ProductCard";
import type { ListingItem } from "./types";
import { canQuickAdd } from "./product-display";
import { useEntranceInitial } from "@/components/motion/useEntrance";

interface ProductGridViewProps {
  items: ListingItem[];
  /** Density from usePreferences — tightens gaps in compact density. */
  compactDensity?: boolean;
  /**
   * Product ids the current customer has already saved — seeds each card's
   * HeartButton so it renders filled on first paint. Absent/undefined for anon
   * (the heart then prompts login on tap). Carries NO price.
   */
  savedProductIds?: ReadonlySet<string>;
  /** Whether the viewer may quick-add in-stock, non-variant products. */
  canAddToCart?: boolean;
}

/**
 * How many leading cards load their image eagerly with high fetch priority.
 * On a phone the LCP element of a listing is the first card image; ~4 covers
 * the first viewport (two rows of the 2-column mobile grid) without turning
 * the whole below-fold grid eager.
 */
const PRIORITY_IMAGE_COUNT = 4;

export function ProductGridView({
  items,
  compactDensity,
  savedProductIds,
  canAddToCart = false,
}: ProductGridViewProps) {
  const entranceInitial = useEntranceInitial("hidden" as const);

  return (
    <motion.ul
      className={cn(
        "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        compactDensity ? "gap-2.5 md:gap-3" : "gap-3 md:gap-4",
      )}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
      initial={entranceInitial}
      animate="show"
    >
      {/* No `layout` prop on the items: layout projection re-measures EVERY
          card on each append (100+ cards after a few load-mores) — jank on
          low-end phones for a shuffle animation the grid doesn't need. The
          entrance stagger stays; under reduced motion nothing animated before
          and nothing does now. */}
      {items.map((item, index) => (
        <motion.li key={item.product.id} variants={staggerItemVariants}>
          <GridCard
            item={item}
            saved={savedProductIds?.has(item.product.id) ?? false}
            canAddToCart={canAddToCart}
            priorityImage={index < PRIORITY_IMAGE_COUNT}
          />
        </motion.li>
      ))}
    </motion.ul>
  );
}

function GridCard({
  item,
  saved,
  canAddToCart,
  priorityImage = false,
}: {
  item: ListingItem;
  saved: boolean;
  canAddToCart: boolean;
  /** First-viewport card: load the image eagerly with high fetch priority (LCP). */
  priorityImage?: boolean;
}) {
  const { product } = item;
  const quickAdd = canQuickAdd(product, canAddToCart) && !product.allocation?.required;

  return (
    <ProductCard
      product={product}
      priceSlot={item.priceSlot}
      priorityImage={priorityImage}
      overlay={
        <>
          {/* Save heart — floats over the image, a 44px target on phones.
              The wrapper swallows the click so tapping the heart toggles the
              save WITHOUT following the card link. */}
          <div
            className="absolute top-1.5 right-1.5 z-10 md:top-2 md:right-2"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <HeartButton
              productId={product.id}
              initialSaved={saved}
              size="card"
              className="bg-background/85 shadow-sm ring-1 ring-foreground/10 backdrop-blur hover:bg-background"
            />
          </div>
          <InCartChip productId={product.id} className="bottom-2 left-2" />
        </>
      }
      action={
        quickAdd ? (
          <QuickAddToCart
            productId={product.id}
            moq={product.moq}
            packMultiple={product.packMultiple}
          />
        ) : null
      }
      // Variant products can't one-tap quick-add (a variant must be picked
      // first — see canQuickAdd), so they get the quick-pick bottom sheet
      // instead: size pills + add, no page trip. The trigger swallows its
      // click; the sheet renders in a portal outside the card link.
      footer={
        product.hasVariants ? (
          <VariantQuickSheet
            productId={product.id}
            slug={product.slug}
            gateSlot={item.priceSlot}
            className="mt-2"
          />
        ) : null
      }
    />
  );
}
