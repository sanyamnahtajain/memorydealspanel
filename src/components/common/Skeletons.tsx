import * as React from "react";
import { cn } from "@/lib/utils";
import "./shimmer.css";

/**
 * Loading skeletons with a token-driven CSS shimmer (see shimmer.css).
 * All skeletons are aria-hidden — pair them with a visually hidden
 * "Loading…" live region at the page level when needed.
 */

/** Bare shimmering block — the building brick for custom skeletons. */
export function Shimmer({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="shimmer"
      className={cn("md-shimmer rounded-md", className)}
      {...props}
    />
  );
}

/** Generic content card: heading, two text lines, footer chip. */
export function SkeletonCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="skeleton-card"
      className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", className)}
      {...props}
    >
      <Shimmer className="h-4 w-2/5" />
      <div className="mt-3 space-y-2">
        <Shimmer className="h-3 w-full" />
        <Shimmer className="h-3 w-4/5" />
      </div>
      <Shimmer className="mt-4 h-6 w-24 rounded-full" />
    </div>
  );
}

interface SkeletonRowProps extends React.ComponentProps<"div"> {
  /** Number of data cells after the leading checkbox square. */
  columns?: number;
}

/** Table/list row: leading checkbox square + variable-width cells. */
export function SkeletonRow({ columns = 4, className, ...props }: SkeletonRowProps) {
  const widths = ["w-full", "w-3/4", "w-1/2", "w-2/3", "w-5/6"];
  return (
    <div
      aria-hidden
      data-slot="skeleton-row"
      className={cn(
        "flex items-center gap-3 border-b border-border px-3 py-2.5",
        className
      )}
      {...props}
    >
      <Shimmer className="size-4 shrink-0 rounded-sm" />
      {Array.from({ length: Math.max(1, columns) }, (_, i) => (
        <div key={i} className="flex-1">
          <Shimmer className={cn("h-3.5", widths[i % widths.length])} />
        </div>
      ))}
    </div>
  );
}

/** Matches the StatCard layout (label, value, delta line). */
export function SkeletonStat({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="skeleton-stat"
      className={cn("rounded-xl border border-border bg-card p-4 shadow-sm", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <Shimmer className="h-3.5 w-24" />
        <Shimmer className="size-8 rounded-lg" />
      </div>
      <Shimmer className="mt-3 h-7 w-28" />
      <Shimmer className="mt-2 h-3 w-20" />
    </div>
  );
}

/** Catalog product card: square image, name lines, price-pill shape. */
export function SkeletonProductCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      data-slot="skeleton-product-card"
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        className
      )}
      {...props}
    >
      <Shimmer className="aspect-square w-full rounded-none" />
      <div className="space-y-2 p-3">
        <Shimmer className="h-3.5 w-5/6" />
        <Shimmer className="h-3 w-1/2" />
        <Shimmer className="mt-3 h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}
