import * as React from "react";

import { cn } from "@/lib/utils";
import { Shimmer } from "@/components/common/Skeletons";

/**
 * Shape-true skeleton parts for the storefront `loading.tsx` fallbacks.
 *
 * Each piece mirrors the REAL component's box — the same radius, ring, aspect
 * ratio and column counts — so the page "develops" in place rather than
 * swapping a grey rectangle for content. Shimmer comes from the shared
 * component-level stylesheet (`components/common/shimmer.css`), never from
 * globals. Everything here is `aria-hidden`; the page-level
 * `<LoadingWatchdog/>` owns the live status text.
 *
 * `_skeletons` is a private folder (leading underscore) so Next never treats
 * it as a route segment.
 */

/* ------------------------------------------------------------------ */
/* Section header: eyebrow · title · "See all" pill                    */
/* ------------------------------------------------------------------ */

export function SkeletonSectionHeader({
  seeAll = true,
  subtitle = false,
  className,
}: {
  seeAll?: boolean;
  subtitle?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      // Same box as SectionHeading: mb-5/6, eyebrow (1rem line), 2xl/3xl
      // title, optional subtitle line, min-h-11 "See all" pill.
      className={cn("mb-5 flex items-end justify-between gap-4 md:mb-6", className)}
    >
      <div className="space-y-2">
        <Shimmer className="h-2.5 w-20 rounded-full" />
        <Shimmer className="h-6 w-44 rounded-lg md:h-7 md:w-56" />
        {subtitle ? <Shimmer className="h-3.5 w-64 max-w-full rounded-full" /> : null}
      </div>
      {seeAll ? <Shimmer className="h-11 w-24 rounded-full" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Product card — rounded-2xl ring, padded contain image, price pill   */
/* ------------------------------------------------------------------ */

export function SkeletonProductTile({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5",
        className,
      )}
    >
      <div className="relative aspect-square w-full bg-muted/60 p-5">
        <Shimmer className="size-full rounded-xl" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <Shimmer className="h-2.5 w-14 rounded-full" />
        <Shimmer className="h-3.5 w-11/12 rounded-full" />
        <Shimmer className="h-3.5 w-2/3 rounded-full" />
        <div className="mt-auto flex items-center justify-between pt-2">
          <Shimmer className="h-7 w-20 rounded-full" />
          <Shimmer className="size-8 rounded-full" />
        </div>
      </div>
    </div>
  );
}

/**
 * The home-rail layout: a snap rail with the next card peeking on phones,
 * a 3/4-column grid from `sm`.
 */
export function SkeletonProductRail({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "-mx-4 grid auto-cols-[minmax(9.5rem,42vw)] grid-flow-col gap-3 overflow-hidden px-4 sm:mx-0 sm:grid-flow-row sm:auto-cols-auto sm:grid-cols-3 sm:px-0 md:gap-4 lg:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: Math.min(count, 4) }, (_, i) => (
        // The 4th tile only exists where there is a 4th column (lg) or the
        // rail scrolls (phones); the 3-column sm/md grid hides it.
        <SkeletonProductTile key={i} className={cn(i === 3 && "sm:hidden lg:flex")} />
      ))}
    </div>
  );
}

/** The listing grid used by category / brand / search results. */
export function SkeletonProductGrid({
  count = 8,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonProductTile key={i} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Category tiles — 4:3 image with the name on a bottom gradient       */
/* ------------------------------------------------------------------ */

export function SkeletonCategoryGrid({
  count = 6,
  teaser = false,
  className,
}: {
  count?: number;
  /**
   * Mirror CategoryGrid's home teaser: 12 tiles, 2 columns on phones with
   * only the first 8 shown (the shared `md-teaser-8` rule), 4 → 6 columns
   * from md. `count` is ignored — the real grid always gets 12.
   */
  teaser?: boolean;
  className?: string;
}) {
  const tiles = teaser ? 12 : count;
  return (
    <div
      aria-hidden
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4",
        teaser ? "md-teaser-8 md:grid-cols-4 lg:grid-cols-6" : "lg:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: tiles }, (_, i) => (
        <div
          key={i}
          className={cn(
            "relative aspect-4/3 overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5",
            !teaser && i >= 4 && "hidden sm:block",
            !teaser && i >= 6 && "sm:hidden lg:block",
          )}
        >
          <Shimmer className="absolute inset-0 rounded-none" />
          <Shimmer className="absolute bottom-3 left-3 h-3.5 w-24 rounded-full bg-foreground/10" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Brand row — small logo chips, two rows on phones                    */
/* ------------------------------------------------------------------ */

export function SkeletonBrandRow({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "-mx-4 grid auto-cols-[6.75rem] grid-flow-col grid-rows-2 gap-2.5 overflow-hidden px-4 md:mx-0 md:grid-flow-row md:auto-cols-auto md:grid-cols-6 md:grid-rows-none md:gap-3 md:px-0",
        className,
      )}
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div
          key={i}
          className="flex min-h-16 flex-col items-center justify-center gap-2 rounded-2xl bg-card px-2 py-3 ring-1 ring-foreground/5"
        >
          <Shimmer className="h-7 w-14 rounded-lg" />
          <Shimmer className="h-2.5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Banner — the hero carousel strip with its dots                      */
/* ------------------------------------------------------------------ */

export function SkeletonBanner({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("relative", className)}>
      <div className="relative aspect-[2/1] w-full overflow-hidden rounded-2xl bg-muted ring-1 ring-foreground/5 sm:aspect-[3/1]">
        <Shimmer className="absolute inset-0 rounded-none" />
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
          <Shimmer className="h-3 w-24 rounded-full bg-foreground/10" />
          <Shimmer className="mt-3 h-6 w-2/3 max-w-xs rounded-lg bg-foreground/10 sm:h-8" />
          <Shimmer className="mt-4 h-9 w-28 rounded-full bg-foreground/10" />
        </div>
      </div>
      <div className="mt-3 flex justify-center gap-1.5">
        <Shimmer className="h-1.5 w-5 rounded-full" />
        <Shimmer className="h-1.5 w-1.5 rounded-full" />
        <Shimmer className="h-1.5 w-1.5 rounded-full" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filter bar — chip row + sort/filter pill                            */
/* ------------------------------------------------------------------ */

export function SkeletonFilterBar({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("flex items-center gap-2 overflow-hidden", className)}
    >
      <Shimmer className="h-10 w-24 shrink-0 rounded-full" />
      <Shimmer className="h-10 w-20 shrink-0 rounded-full" />
      <Shimmer className="h-10 w-28 shrink-0 rounded-full" />
      <Shimmer className="hidden h-10 w-24 shrink-0 rounded-full sm:block" />
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Shimmer className="h-4 w-16 rounded-full" />
        <Shimmer className="h-10 w-10 rounded-full" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page title block — back link · title · subtitle                     */
/* ------------------------------------------------------------------ */

export function SkeletonPageTitle({
  back = true,
  subtitle = true,
  logo = false,
  className,
}: {
  back?: boolean;
  subtitle?: boolean;
  logo?: boolean;
  className?: string;
}) {
  return (
    <div aria-hidden className={cn("mt-2 space-y-3", className)}>
      {back ? <Shimmer className="h-3.5 w-24 rounded-full" /> : null}
      <div className="flex items-center gap-3">
        {logo ? <Shimmer className="size-12 rounded-2xl" /> : null}
        <Shimmer className="h-8 w-56 rounded-lg md:h-9 md:w-72" />
      </div>
      {subtitle ? <Shimmer className="h-4 w-72 max-w-full rounded-full" /> : null}
    </div>
  );
}
