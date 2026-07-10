"use client";

/**
 * RelatedRail — a horizontal "More in this category" rail on the product
 * detail page.
 *
 * PRICE-GATE CONTRACT (identical to ProductCardGrid): this client component
 * NEVER receives raw price fields and never formats money. Each item's
 * `priceSlot` is a server-rendered React node produced by `renderPriceSlot`
 * (which decides, per viewer, between an animated PriceReveal and a locked
 * "See price" chip). For anon / pending / expired viewers the slot is a locked
 * chip and no amount ever crosses into this client component.
 *
 * The rail is an Embla carousel (swipe on touch, arrow buttons on pointer
 * devices) with snap points per card. It reuses the same shared-element
 * `view-transition-name` seam as the grid card so navigating into a related
 * product morphs its thumbnail into the next page's hero.
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import useEmblaCarousel from "embla-carousel-react";
import { useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, ImageOff } from "lucide-react";

import type { PublicProduct } from "@/server/dto/product";
import {
  GALLERY_HERO_CLASS,
  galleryTransitionName,
} from "@/components/storefront/ProductGallery";
import { cn } from "@/lib/utils";

export interface RelatedRailItem {
  product: PublicProduct;
  priceSlot: React.ReactNode;
}

export interface RelatedRailProps {
  items: RelatedRailItem[];
  className?: string;
}

export function RelatedRail({ items, className }: RelatedRailProps) {
  const reduced = useReducedMotion();
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: false,
    align: "start",
    dragFree: true,
    duration: reduced ? 0 : 22,
    containScroll: "trimSnaps",
  });

  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(false);

  React.useEffect(() => {
    if (!emblaApi) return;
    const sync = () => {
      setCanPrev(emblaApi.canScrollPrev());
      setCanNext(emblaApi.canScrollNext());
    };
    sync();
    emblaApi.on("select", sync);
    emblaApi.on("reInit", sync);
    return () => {
      emblaApi.off("select", sync);
      emblaApi.off("reInit", sync);
    };
  }, [emblaApi]);

  const scrollPrev = React.useCallback(
    () => emblaApi?.scrollPrev(),
    [emblaApi],
  );
  const scrollNext = React.useCallback(
    () => emblaApi?.scrollNext(),
    [emblaApi],
  );

  if (items.length === 0) return null;

  return (
    <section className={cn("relative", className)} aria-label="Related products">
      <div ref={emblaRef} className="overflow-hidden">
        <ul className="flex gap-3 md:gap-4">
          {items.map((item) => (
            <li
              key={item.product.id}
              className="min-w-0 shrink-0 grow-0 basis-[45%] sm:basis-[32%] lg:basis-[23%]"
            >
              <RelatedCard item={item} />
            </li>
          ))}
        </ul>
      </div>

      {items.length > 1 ? (
        <>
          <RailArrow
            direction="prev"
            disabled={!canPrev}
            onClick={scrollPrev}
          />
          <RailArrow
            direction="next"
            disabled={!canNext}
            onClick={scrollNext}
          />
        </>
      ) : null}
    </section>
  );
}

function primaryImage(product: PublicProduct) {
  if (product.images.length === 0) return null;
  return (
    product.images.find((img) => img.isPrimary) ??
    [...product.images].sort((a, b) => a.sortOrder - b.sortOrder)[0] ??
    null
  );
}

function RelatedCard({ item }: { item: RelatedRailItem }) {
  const { product } = item;
  const image = primaryImage(product);

  return (
    <Link
      href={`/p/${product.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm outline-none transition-shadow hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
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
        {product.brand ? (
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

interface RailArrowProps {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}

function RailArrow({ direction, disabled, onClick }: RailArrowProps) {
  const isPrev = direction === "prev";
  const Icon = isPrev ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isPrev ? "Scroll to previous products" : "Scroll to more products"}
      className={cn(
        "absolute top-[38%] hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/90 text-foreground shadow-sm backdrop-blur transition-opacity hover:bg-background disabled:pointer-events-none disabled:opacity-0 md:flex",
        isPrev ? "-left-3" : "-right-3",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
