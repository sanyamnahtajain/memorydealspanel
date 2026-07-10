"use client";

/**
 * LoadMoreButton — cursor/page "load more" control for the listing.
 *
 * Auto-loads via an IntersectionObserver sentinel as it nears the viewport,
 * with an explicit button fallback (and a manual-retry path if a fetch fails).
 * It never touches prices — it only asks the parent to append the next page
 * of already-gated items.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";

interface LoadMoreButtonProps {
  /** Whether more pages remain. */
  hasMore: boolean;
  /** In-flight state (owned by the parent). */
  pending: boolean;
  onLoadMore: () => void;
  /** Suppress auto-loading (e.g. under reduced motion / user preference). */
  disableAutoLoad?: boolean;
}

export function LoadMoreButton({
  hasMore,
  pending,
  onLoadMore,
  disableAutoLoad,
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
    <div ref={sentinelRef} className="mt-6 flex items-center justify-center">
      <button
        type="button"
        onClick={onLoadMore}
        disabled={pending}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
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
    </div>
  );
}
