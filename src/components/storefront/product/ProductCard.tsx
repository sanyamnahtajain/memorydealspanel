"use client";

/**
 * ProductCard — THE product card. One look for every surface that shows a
 * product tile: the listing grid, the home rails (Best sellers, New &
 * featured, Trending now), the related rail on the detail page.
 *
 * PRICE-GATE CONTRACT: this component never receives a money field and never
 * formats money. `priceSlot` is a server-rendered node (a PriceReveal for a
 * price-authorised viewer, a locked chip otherwise, or `null` for a shelf
 * that shows no price at all). The card only PLACES that node and styles its
 * wrapper — the node itself is untouched.
 *
 * THE LOOK (design brief): a soft neutral image well with the shot
 * `object-contain` and padded, so headphones and cables are never cropped;
 * a hairline ring instead of a grey border; brand eyebrow, a two-line title
 * with a reserved height (no dead space under short names), a spec snippet,
 * and a bottom row holding the price slot and an optional action.
 *
 * HOVER (desktop only): the shot scales gently and, when the product has a
 * second image, cross-fades to it. The second image is NOT in the markup
 * until the first mouse hover — no extra bytes for phones or for cards that
 * are never hovered — and the fade only starts once it has actually loaded,
 * so there is never a blank frame between the two.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ImageOff } from "lucide-react";

import type { PublicProduct, PublicProductImage } from "@/server/dto/product";
import { BrandBadge } from "@/components/storefront/BrandBadge";
import {
  GALLERY_HERO_CLASS,
  galleryTransitionName,
} from "@/components/storefront/ProductGallery";
import { cn } from "@/lib/utils";

/** Default `sizes` for a card in the 2/3/4-column grid or a snap rail. */
export const PRODUCT_CARD_SIZES =
  "(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw";

/**
 * The shot to lead with (primary flag, else lowest sortOrder) and the one to
 * cross-fade to on hover (the next in order), if any.
 */
export function cardImages(product: PublicProduct): {
  primary: PublicProductImage | null;
  secondary: PublicProductImage | null;
} {
  if (product.images.length === 0) return { primary: null, secondary: null };
  const ordered = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder);
  const primary = ordered.find((img) => img.isPrimary) ?? ordered[0] ?? null;
  const secondary = ordered.find((img) => img !== primary) ?? null;
  return { primary, secondary };
}

/**
 * A short spec line from the specs object (first couple of string/number
 * values) or, failing that, the first tags. Price-free by construction.
 */
export function cardSpecSnippet(product: PublicProduct, max = 2): string | null {
  const { specs } = product;
  if (specs && typeof specs === "object" && !Array.isArray(specs)) {
    const parts = Object.entries(specs as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .slice(0, max)
      .map(([, v]) => String(v));
    if (parts.length > 0) return parts.join(" · ");
  }
  return product.tags.length > 0 ? product.tags.slice(0, max).join(" · ") : null;
}

/**
 * The pack line under a card's name — Blinkit shows "500 ml"; a wholesale
 * buyer needs the trade minimum and pack size instead ("Min 10 · packs of 5").
 * Null when the product sells by the piece with no minimum.
 */
export function cardPackLine(product: Pick<PublicProduct, "moq" | "packMultiple">): string | null {
  const moq = typeof product.moq === "number" && product.moq > 1 ? product.moq : null;
  const pack = typeof product.packMultiple === "number" && product.packMultiple > 1 ? product.packMultiple : null;
  if (moq && pack) return `Min ${moq} · packs of ${pack}`;
  if (moq) return `Min ${moq} pcs`;
  if (pack) return `Packs of ${pack}`;
  return null;
}

export interface ProductCardProps {
  product: PublicProduct;
  /** Server-rendered price node (or null for a price-free shelf). Never money. */
  priceSlot: React.ReactNode;
  /** First-viewport card: eager, high-priority image (LCP). */
  priorityImage?: boolean;
  /** `sizes` for the image; defaults to the grid/rail estimate. */
  sizes?: string;
  /**
   * Carry the shared-element View Transition seam into the detail hero.
   * Pass `false` on a surface where the same product can appear twice on one
   * page (two rails on home) — duplicate names disable the transition.
   */
  transitionSeam?: boolean;
  /**
   * Controls floated over the image (wishlist heart, in-cart chip). They
   * position themselves; a control that must not follow the card link
   * swallows its own click.
   */
  overlay?: React.ReactNode;
  /** Bottom-row action beside the price slot (QuickAddToCart). */
  action?: React.ReactNode;
  /** Rendered under the bottom row (the variant quick-pick trigger). */
  footer?: React.ReactNode;
  /** Show the spec/tag snippet line. Defaults to true. */
  showSnippet?: boolean;
  className?: string;
}

export function ProductCard({
  product,
  priceSlot,
  priorityImage = false,
  sizes = PRODUCT_CARD_SIZES,
  transitionSeam = true,
  overlay,
  action,
  footer,
  showSnippet = true,
  className,
}: ProductCardProps) {
  const { primary, secondary } = cardImages(product);
  const snippet = showSnippet ? cardSpecSnippet(product) : null;
  const packLine = showSnippet ? cardPackLine(product) : null;

  // Second image: mounted on the first MOUSE hover only (touch never pays for
  // it), and faded in only once it has loaded.
  const [hoverArmed, setHoverArmed] = React.useState(false);
  const [secondLoaded, setSecondLoaded] = React.useState(false);
  const canCrossfade = secondary !== null && secondLoaded;

  const brandName = product.brandRef?.name ?? product.brand;

  return (
    <Link
      href={`/p/${product.slug}`}
      prefetch={false}
      onPointerEnter={(e) => {
        if (secondary && e.pointerType === "mouse") setHoverArmed(true);
      }}
      className={cn(
        "group md-reveal flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card outline-none",
        "transition-[box-shadow,transform,border-color] duration-200 ease-out",
        "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98]",
        className,
      )}
    >
      {/* IMAGE WELL — a soft neutral surface, the shot contained and padded. */}
      <div className="relative aspect-square w-full overflow-hidden bg-muted/60">
        {overlay}
        {primary ? (
          <div className="absolute inset-3 sm:inset-4">
            <Image
              src={primary.thumbUrl ?? primary.url}
              alt={product.name}
              fill
              priority={priorityImage}
              sizes={sizes}
              className={cn(
                // Shared-element seam: the detail gallery's hero carries the
                // same class + view-transition-name, so a supporting browser
                // morphs this thumbnail into the hero. Others cross-fade.
                transitionSeam && GALLERY_HERO_CLASS,
                "object-contain mix-blend-multiply transition-[transform,opacity] duration-500 ease-out group-hover:scale-[1.04]",
                canCrossfade && "group-hover:opacity-0",
              )}
              style={
                transitionSeam
                  ? { viewTransitionName: galleryTransitionName(product.id) }
                  : undefined
              }
            />
            {hoverArmed && secondary ? (
              <Image
                src={secondary.thumbUrl ?? secondary.url}
                alt=""
                aria-hidden
                fill
                sizes={sizes}
                onLoad={() => setSecondLoaded(true)}
                className={cn(
                  "object-contain mix-blend-multiply opacity-0 transition-[transform,opacity] duration-500 ease-out group-hover:scale-[1.04]",
                  canCrossfade && "group-hover:opacity-100",
                )}
              />
            ) : null}
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <ImageOff className="size-7" aria-hidden />
            <span className="text-[11px] font-medium">No photo yet</span>
          </div>
        )}
      </div>

      {/* TEXT BLOCK — reserved title height, so a short name leaves no hole. */}
      <div className="@container flex flex-1 flex-col px-2.5 pt-2 pb-2.5 sm:px-3 sm:pt-2.5 sm:pb-3">
        {product.brandRef ? (
          <BrandBadge
            name={product.brandRef.name}
            slug={product.brandRef.slug}
            asLink={false}
            className="text-[10px] tracking-[0.12em] sm:text-[11px]"
          />
        ) : brandName ? (
          <span className="truncate text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase sm:text-[11px]">
            {brandName}
          </span>
        ) : null}
        {/* Blinkit's card text: a compact two-line name, then ONE grey line
            for the pack (here: the trade minimum / pack size, else specs). */}
        <h3 className="mt-0.5 line-clamp-2 min-h-[2.25rem] text-[13px] leading-snug font-semibold tracking-tight text-foreground sm:min-h-[2.6rem] sm:text-[15px]">
          {product.name}
        </h3>
        {packLine ?? snippet ? (
          <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground sm:text-xs">
            {packLine ?? snippet}
          </p>
        ) : null}

        {priceSlot || action ? (
          // A narrow card (the brand page beside its category rail) has no room
          // for price + MRP + ADD on one line: there the action drops to its own
          // full-width row, Blinkit-style, instead of sliding over the price.
          <div className="mt-auto flex items-end justify-between gap-2 pt-2.5 @max-[9.75rem]:flex-col @max-[9.75rem]:items-stretch">
            {/* The slot node is untouched; only its wrapper is styled: the
                price reads a step larger than the metadata around it. */}
            <div className="min-w-0 flex-1 @max-[9.75rem]:flex-none [&_[data-slot=price-reveal]>span:first-child]:text-[15px] [&_[data-slot=price-pill]]:h-7 [&_[data-slot=price-pill]]:px-2.5 [&_[data-slot=price-pill]]:text-[13px]">
              {priceSlot}
            </div>
            {action ? (
              <div className="shrink-0 @max-[9.75rem]:[&>*]:w-full">{action}</div>
            ) : null}
          </div>
        ) : null}

        {footer}
      </div>
    </Link>
  );
}
