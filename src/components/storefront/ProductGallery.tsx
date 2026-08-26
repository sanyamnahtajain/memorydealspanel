"use client";

import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import { useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, ImageOff, Maximize2 } from "lucide-react";
import type { PublicProductImage } from "@/server/dto/product";
import { Lightbox } from "@/components/storefront/Lightbox";
import { cn } from "@/lib/utils";

/**
 * Stable class applied to the primary gallery image. The product card marks
 * its thumbnail with the same class + a per-product `view-transition-name`
 * (see the storefront card), letting the browser run a shared-element morph
 * between the grid and this detail view via the View Transitions API. We only
 * expose the target here; the card owns the outgoing side and the name.
 */
export const GALLERY_HERO_CLASS = "md-gallery-hero";

/**
 * Derives the `view-transition-name` for a product's hero image. Kept in one
 * place so the card and the gallery agree. Must be a valid CSS ident.
 */
export function galleryTransitionName(productId: string): string {
  return `product-hero-${productId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export interface ProductGalleryProps {
  images: PublicProductImage[];
  /** Product name — used for descriptive alt text. */
  productName: string;
  /** Product id — seeds the shared-element View Transition name. */
  productId: string;
  className?: string;
}

/**
 * Swipeable product gallery (Embla) with a thumbnail rail and a fullscreen
 * lightbox.
 *
 * - Main carousel: horizontal swipe, arrow buttons on pointer devices.
 * - Thumbnails: a synced strip; the active thumb is highlighted and scrolled
 *   into view.
 * - Fullscreen: tapping the main image opens the {@link Lightbox} at that
 *   photo (swipe, double-tap zoom, pan; Esc or tap closes).
 * - Reduced motion: disables Embla's animated scroll (instant jumps); the
 *   lightbox handles its own `motion-reduce` transitions.
 *
 * Renders `PublicProductImage`s only — it carries no price and is safe for any
 * viewer.
 */
export function ProductGallery({
  images,
  productName,
  productId,
  className,
}: ProductGalleryProps) {
  const reducedMotion = useReducedMotion();

  const ordered = React.useMemo(
    () => [...images].sort((a, b) => a.sortOrder - b.sortOrder),
    [images],
  );

  const [mainRef, mainApi] = useEmblaCarousel({
    loop: false,
    duration: reducedMotion ? 0 : 22,
    align: "center",
  });
  const [thumbRef, thumbApi] = useEmblaCarousel({
    containScroll: "keepSnaps",
    dragFree: true,
    align: "start",
  });

  const [selected, setSelected] = React.useState(0);
  /** Index the lightbox opened at; `null` while it is closed. */
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);

  // `selected` is the single source of truth for which slide is active; the
  // arrow-enabled state is derived from it (no separate effect/setState), and
  // the thumbnail rail is synced imperatively when it changes.
  React.useEffect(() => {
    if (!mainApi) return;
    // The subscription (not a synchronous call) drives all updates; Embla
    // fires `select` on init after settling, keeping React in sync.
    const sync = () => {
      const index = mainApi.selectedScrollSnap();
      setSelected(index);
      thumbApi?.scrollTo(index);
    };
    mainApi.on("select", sync);
    mainApi.on("reInit", sync);
    return () => {
      mainApi.off("select", sync);
      mainApi.off("reInit", sync);
    };
  }, [mainApi, thumbApi]);

  const scrollTo = React.useCallback(
    (index: number) => mainApi?.scrollTo(index),
    [mainApi],
  );
  const scrollPrev = React.useCallback(() => mainApi?.scrollPrev(), [mainApi]);
  const scrollNext = React.useCallback(() => mainApi?.scrollNext(), [mainApi]);

  const canPrev = selected > 0;
  const canNext = selected < ordered.length - 1;

  if (ordered.length === 0) {
    return (
      <div
        className={cn(
          "flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-3xl border border-border/60 bg-muted/40 text-muted-foreground",
          className,
        )}
      >
        <ImageOff aria-hidden className="size-8" />
        <span className="text-sm">No image available</span>
      </div>
    );
  }

  const showControls = ordered.length > 1;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <div
          ref={mainRef}
          className="overflow-hidden rounded-3xl bg-card shadow-sm ring-1 ring-foreground/5"
        >
          <div className="flex touch-pan-y">
            {ordered.map((image, index) => {
              const isHero = index === 0;
              const isActive = index === selected;
              return (
                <div
                  key={`${image.url}-${index}`}
                  className="relative min-w-0 shrink-0 grow-0 basis-full"
                >
                  <button
                    type="button"
                    onClick={() => setLightboxIndex(index)}
                    aria-label={`View image ${index + 1} full screen`}
                    className="group relative block aspect-square w-full cursor-zoom-in overflow-hidden bg-muted/30"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={image.url}
                      alt={`${productName} — image ${index + 1}`}
                      draggable={false}
                      loading={isHero ? "eager" : "lazy"}
                      // The hero is the page's LCP element: without an explicit
                      // priority hint it queues behind CSS/fonts even though it
                      // is eager (perf finding 3).
                      fetchPriority={isHero ? "high" : "auto"}
                      className={cn(
                        "h-full w-full object-contain",
                        isHero && GALLERY_HERO_CLASS,
                      )}
                      style={
                        isHero
                          ? {
                              viewTransitionName:
                                galleryTransitionName(productId),
                            }
                          : undefined
                      }
                    />
                    {isActive ? (
                      <span
                        aria-hidden
                        className="absolute right-2.5 bottom-2.5 inline-flex items-center gap-1 rounded-full bg-foreground/70 px-2 py-1 text-xs font-medium text-background opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Maximize2 className="size-3.5" />
                        Expand
                      </span>
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {showControls ? (
          <>
            <GalleryArrow
              direction="prev"
              disabled={!canPrev}
              onClick={scrollPrev}
            />
            <GalleryArrow
              direction="next"
              disabled={!canNext}
              onClick={scrollNext}
            />
            <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-background/75 px-2 py-1.5 backdrop-blur-sm sm:hidden">
              {ordered.map((_, index) => (
                <span
                  key={index}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    index === selected ? "w-5 bg-foreground" : "w-1.5 bg-foreground/25",
                  )}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>

      {showControls ? (
        <div ref={thumbRef} className="overflow-hidden">
          <div className="flex gap-2">
            {ordered.map((image, index) => {
              const isActive = index === selected;
              return (
                <button
                  key={`thumb-${image.url}-${index}`}
                  type="button"
                  onClick={() => scrollTo(index)}
                  aria-label={`Show image ${index + 1}`}
                  aria-current={isActive}
                  className={cn(
                    "relative aspect-square w-16 shrink-0 overflow-hidden rounded-xl border bg-muted/30 transition-[border-color,opacity,box-shadow] sm:w-20",
                    isActive
                      ? "border-primary ring-2 ring-primary/40"
                      : "border-border opacity-80 hover:border-foreground/30 hover:opacity-100",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.thumbUrl ?? image.url}
                    alt=""
                    draggable={false}
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {lightboxIndex !== null ? (
        <Lightbox
          images={ordered}
          name={productName}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </div>
  );
}

interface GalleryArrowProps {
  direction: "prev" | "next";
  disabled: boolean;
  onClick: () => void;
}

function GalleryArrow({ direction, disabled, onClick }: GalleryArrowProps) {
  const isPrev = direction === "prev";
  const Icon = isPrev ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={isPrev ? "Previous image" : "Next image"}
      className={cn(
        "absolute top-1/2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-background/85 text-foreground shadow-sm backdrop-blur transition-opacity hover:bg-background disabled:pointer-events-none disabled:opacity-0 sm:flex",
        isPrev ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-5" aria-hidden />
    </button>
  );
}
