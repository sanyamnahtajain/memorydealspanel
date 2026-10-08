"use client";

/**
 * RelatedRail — a horizontal "Shops also ordered" rail on the product
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
 * devices) with snap points per card and the next card peeking on phones. It
 * renders the shared {@link ProductCard}, so a related product morphs its
 * thumbnail into the next page's hero through the same view-transition seam
 * as the listing grid.
 */

import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import { useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import type { PublicProduct } from "@/server/dto/product";
import { cn } from "@/lib/utils";
import { ProductCard } from "./ProductCard";

export interface RelatedRailItem {
  product: PublicProduct;
  priceSlot: React.ReactNode;
}

export interface RelatedRailProps {
  items: RelatedRailItem[];
  /**
   * Full-bleed on phones: the rail breaks out of the page gutter (-mx-4) and
   * pads its track instead, so cards scroll edge-to-edge under the thumb.
   * Contained again from md: up. Matches StorefrontShell's px-4 gutter.
   */
  bleed?: boolean;
  className?: string;
}

export function RelatedRail({ items, bleed = false, className }: RelatedRailProps) {
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
    <section
      className={cn("relative", bleed && "-mx-4 md:mx-0", className)}
      aria-label="Related products"
    >
      <div ref={emblaRef} className="overflow-hidden">
        <ul className={cn("flex gap-3 md:gap-4", bleed && "px-4 md:px-0")}>
          {items.map((item) => (
            <li
              key={item.product.id}
              // 42% on phones leaves the third card peeking in from the edge.
              className="min-w-0 shrink-0 grow-0 basis-[42%] sm:basis-[32%] lg:basis-[23%]"
            >
              <ProductCard
                product={item.product}
                priceSlot={item.priceSlot}
                showSnippet={false}
                sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 42vw"
              />
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
        "absolute top-[38%] hidden size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/95 text-foreground shadow-md ring-1 ring-foreground/10 backdrop-blur transition-[opacity,transform] hover:bg-background active:scale-95 disabled:pointer-events-none disabled:opacity-0 md:flex",
        isPrev ? "-left-4" : "-right-4",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
