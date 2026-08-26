"use client";

/**
 * FeaturedRail — the "New & featured" product rail on the home page.
 *
 * PRICE-GATE CONTRACT: like {@link ProductCardGrid}, this client component never
 * receives raw money. Each item's `priceSlot` is a server-rendered node (a
 * PriceReveal for approved viewers, a locked chip otherwise) produced by
 * `renderPriceSlot`. On the ISR home shell the slots are rendered for the
 * anonymous viewer, so they are always locked — correct for a shared cache.
 *
 * On desktop it lays out as a responsive grid; on narrow screens it becomes a
 * snap-scrolling horizontal rail so all featured items stay reachable with one
 * thumb. Entrance is staggered and honours reduced-motion.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "motion/react";

import type { ProductCardItem } from "@/components/storefront/ProductCardGrid";
import {
  GALLERY_HERO_CLASS,
  galleryTransitionName,
} from "@/components/storefront/ProductGallery";
import { BrandBadge } from "@/components/storefront/BrandBadge";

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
  const reduced = useReducedMotion();

  return (
    <motion.ul
      className="grid auto-cols-[minmax(9.5rem,1fr)] grid-flow-col gap-3 overflow-x-auto scroll-smooth pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-3 sm:overflow-visible md:gap-4 lg:grid-cols-4"
      variants={containerVariants}
      initial={reduced ? "show" : "hidden"}
      animate="show"
    >
      {items.map((item, index) => (
        <motion.li
          key={item.product.id}
          variants={itemVariants}
          className="snap-start"
        >
          <FeaturedCard
            item={item}
            priorityImage={index < priorityImageCount}
          />
        </motion.li>
      ))}
    </motion.ul>
  );
}

function FeaturedCard({
  item,
  priorityImage = false,
}: {
  item: ProductCardItem;
  /** First-viewport card: load the image eagerly with high fetch priority (LCP). */
  priorityImage?: boolean;
}) {
  const { product } = item;
  const image =
    product.images.find((img) => img.isPrimary) ?? product.images[0] ?? null;

  return (
    <Link
      href={`/p/${product.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 hover:shadow-md active:scale-[0.99]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {image ? (
          <Image
            src={image.thumbUrl ?? image.url}
            alt={product.name}
            fill
            priority={priorityImage}
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
        <div className="mt-auto pt-2">{item.priceSlot}</div>
      </div>
    </Link>
  );
}
