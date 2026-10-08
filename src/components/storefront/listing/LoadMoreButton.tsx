"use client";

/**
 * LoadMoreButton — cursor/page "load more" control for the listing.
 *
 * Auto-loads via an IntersectionObserver sentinel as it nears the viewport,
 * with an explicit button fallback (and a manual-retry path if a fetch fails).
 * While a page is in flight it shows a row of skeleton cards in the grid's own
 * shape, so the list visibly grows instead of stalling on a spinner. It never
 * touches prices — it only asks the parent to append the next page of
 * already-gated items.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Shimmer } from "@/components/common/Skeletons";
import { hapticTap } from "@/lib/haptics";

interface LoadMoreButtonProps {
  /** Whether more pages remain. */
  hasMore: boolean;
  /** In-flight state (owned by the parent). */
  pending: boolean;
  onLoadMore: () => void;
  /** Suppress auto-loading (e.g. under reduced motion / user preference). */
  disableAutoLoad?: boolean;
  /** Items on the page so far — drives the "Showing X of Y" caption. */
  shown?: number;
  /** Authoritative total when known. */
  total?: number;
  /** Skeleton cards to paint while pending; 0 hides them. */
  skeletonCount?: number;
}

export function LoadMoreButton({
  hasMore,
  pending,
  onLoadMore,
  disableAutoLoad,
  shown,
  total,
  skeletonCount = 4,
}: LoadMoreButtonProps) {
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const onLoadRef = React.useRef(onLoadMore);
  React.useEffect(() => {
    onLoadRef.current = onLoadMore;
  }, [onLoadMore]);

  React.useEffect(() => {
    if (!hasMore || disableAutoLoad || pending) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadRef.current();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, disableAutoLoad, pending]);

  if (!hasMore) return null;

  return (
    <div ref={sentinelRef} className="mt-6">
      {pending && skeletonCount > 0 ? (
        <LoadMoreSkeleton count={skeletonCount} />
      ) : null}

      <div className="mt-6 flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => {
            hapticTap();
            onLoadMore();
          }}
          disabled={pending}
          className="inline-flex min-h-11 w-full max-w-xs items-center justify-center gap-2 rounded-full bg-card px-6 text-sm font-semibold text-foreground shadow-sm ring-1 ring-foreground/10 outline-none transition-[background-color,transform,box-shadow] hover:bg-muted hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] disabled:opacity-70"
        >
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Loading…
            </>
          ) : (
            "Load more"
          )}
        </button>
        {shown !== undefined ? (
          <p className="font-tabular text-xs text-muted-foreground">
            {total !== undefined && total > shown
              ? `Showing ${shown.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`
              : `Showing ${shown.toLocaleString("en-IN")} so far`}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Skeleton cards in the listing grid's shape (image well + two lines + pill). */
export function LoadMoreSkeleton({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  return (
    <ul
      aria-hidden
      className={cn(
        "grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <li
          key={i}
          className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/5"
        >
          <Shimmer className="aspect-square w-full rounded-none bg-muted/60" />
          <div className="space-y-2 px-3 pt-2.5 pb-3">
            <Shimmer className="h-2.5 w-1/3" />
            <Shimmer className="h-3.5 w-5/6" />
            <Shimmer className="h-3.5 w-2/3" />
            <Shimmer className="mt-3 h-7 w-20 rounded-full" />
          </div>
        </li>
      ))}
    </ul>
  );
}
