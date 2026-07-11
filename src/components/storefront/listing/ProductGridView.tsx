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
 * {@link import("./StorefrontListing").StorefrontListing}.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { staggerItemVariants } from "@/components/motion/primitives";
import {
  GALLERY_HERO_CLASS,
  galleryTransitionName,
} from "@/components/storefront/ProductGallery";
import { BrandBadge } from "@/components/storefront/BrandBadge";
import { HeartButton } from "@/components/storefront/wishlist/HeartButton";
import type { ListingItem } from "./types";
import { keySpec, primaryImage } from "./product-display";

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
}

export function ProductGridView({
  items,
  compactDensity,
  savedProductIds,
}: ProductGridViewProps) {
  const reduced = useReducedMotion();

  return (
    <motion.ul
      className={cn(
        "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4",
        compactDensity ? "gap-2.5 md:gap-3" : "gap-3 md:gap-4",
      )}
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
      initial={reduced ? "show" : "hidden"}
      animate="show"
    >
      {items.map((item) => (
        <motion.li
          key={item.product.id}
          variants={staggerItemVariants}
          layout={!reduced}
        >
          <GridCard
            item={item}
            saved={savedProductIds?.has(item.product.id) ?? false}
          />
        </motion.li>
      ))}
    </motion.ul>
  );
}

function GridCard({ item, saved }: { item: ListingItem; saved: boolean }) {
  const { product } = item;
  const image = primaryImage(product);
  const snippet = keySpec(product);

  return (
    <Link
      href={`/p/${product.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {/* Save heart — floats over the image. The wrapper swallows the click so
            tapping the heart toggles the save WITHOUT following the card link. */}
        <div
          className="absolute top-1.5 right-1.5 z-10"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <HeartButton
            productId={product.id}
            initialSaved={saved}
            size="compact"
            className="bg-background/80 shadow-sm ring-1 ring-border/50 backdrop-blur hover:bg-background"
          />
        </div>
        {image ? (
          <Image
            src={image.thumbUrl ?? image.url}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
            className={`${GALLERY_HERO_CLASS} object-cover transition-transform duration-300 ease-out group-hover:scale-105`}
            style={{ viewTransitionName: galleryTransitionName(product.id) }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-7" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.brandRef ? (
          <BrandBadge
            name={product.brandRef.name}
            slug={product.brandRef.slug}
            asLink={false}
          />
        ) : product.brand ? (
          <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            {product.brand}
          </span>
        ) : null}
        <h3 className="line-clamp-2 text-sm font-semibold text-foreground">
          {product.name}
        </h3>
        {snippet ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">{snippet}</p>
        ) : null}
        <div className="mt-auto pt-2">{item.priceSlot}</div>
      </div>
    </Link>
  );
}
