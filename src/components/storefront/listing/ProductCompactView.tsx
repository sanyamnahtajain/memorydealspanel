"use client";

/**
 * ProductCompactView — dense list rows: thumbnail, name + brand, key spec,
 * MOQ + stock, and the price slot. Optimised for scanning many products.
 *
 * PRICE-GATE CONTRACT: identical to the grid — each row's price cell simply
 * renders the server-built `priceSlot` (real price for approved viewers, the
 * locked chip otherwise). No money value is ever present in this client
 * component.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/common/StatusChip";
import { BrandBadge } from "@/components/storefront/BrandBadge";
import { HeartButton } from "@/components/storefront/wishlist/HeartButton";
import { QuickAddToCart } from "@/components/storefront/cart/QuickAddToCart";
import { staggerItemVariants } from "@/components/motion/primitives";
import type { ListingItem } from "./types";
import { canQuickAdd, keySpec, stockChipVariant, thumbUrl } from "./product-display";

interface ProductCompactViewProps {
  items: ListingItem[];
  compactDensity?: boolean;
  /**
   * Product ids the current customer has saved — seeds each row's HeartButton
   * so it paints filled immediately. Absent for anon (heart prompts login).
   */
  savedProductIds?: ReadonlySet<string>;
  /** Whether the viewer may quick-add in-stock, non-variant products. */
  canAddToCart?: boolean;
}

export function ProductCompactView({
  items,
  compactDensity,
  savedProductIds,
  canAddToCart = false,
}: ProductCompactViewProps) {
  const reduced = useReducedMotion();

  return (
    <motion.ul
      className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.025 } } }}
      initial={reduced ? "show" : "hidden"}
      animate="show"
    >
      {items.map((item) => (
        <motion.li key={item.product.id} variants={staggerItemVariants} layout={!reduced}>
          <CompactRow
            item={item}
            compactDensity={compactDensity}
            saved={savedProductIds?.has(item.product.id) ?? false}
            canAddToCart={canAddToCart}
          />
        </motion.li>
      ))}
    </motion.ul>
  );
}

function CompactRow({
  item,
  compactDensity,
  saved,
  canAddToCart,
}: {
  item: ListingItem;
  compactDensity?: boolean;
  saved: boolean;
  canAddToCart: boolean;
}) {
  const { product } = item;
  const url = thumbUrl(product);
  const snippet = keySpec(product);
  const quickAdd = canQuickAdd(product, canAddToCart);

  return (
    <Link
      href={`/p/${product.slug}`}
      className={cn(
        "group flex items-center gap-3 outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
        compactDensity ? "px-2.5 py-2" : "px-3 py-2.5",
      )}
    >
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-lg bg-muted",
          compactDensity ? "size-12" : "size-14",
        )}
      >
        {url ? (
          <Image
            src={url}
            alt={product.name}
            fill
            sizes="56px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-5" aria-hidden />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {product.brandRef ? (
          <BrandBadge
            name={product.brandRef.name}
            slug={product.brandRef.slug}
            asLink={false}
            className="max-w-full"
          />
        ) : product.brand ? (
          <span className="block truncate text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            {product.brand}
          </span>
        ) : null}
        <h3 className="truncate text-sm font-semibold text-foreground">{product.name}</h3>
        {snippet ? (
          <p className="truncate text-xs text-muted-foreground">{snippet}</p>
        ) : null}
      </div>

      <div className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
        {product.moq !== null ? (
          <span className="text-[0.7rem] text-muted-foreground">
            MOQ <span className="font-tabular font-medium text-foreground">{product.moq}</span>
          </span>
        ) : null}
        <StatusChip variant={stockChipVariant(product.stockStatus)} />
      </div>

      <div className="shrink-0 pl-1">{item.priceSlot}</div>

      {/* Save heart — swallow the click so it doesn't follow the row link. */}
      <div
        className="shrink-0"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <HeartButton
          productId={product.id}
          initialSaved={saved}
          size="compact"
        />
      </div>

      {/* Quick add — swallow the click so it doesn't follow the row link. */}
      {quickAdd ? (
        <div
          className="shrink-0"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <QuickAddToCart productId={product.id} moq={product.moq} />
        </div>
      ) : null}
    </Link>
  );
}
