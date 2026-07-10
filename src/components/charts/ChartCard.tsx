import * as React from "react";
import { cn } from "@/lib/utils";
import { EmptyState, Shimmer } from "@/components/common";

interface ChartCardProps {
  title: string;
  /** Optional line under the title. */
  subtitle?: string;
  /** Optional node rendered at the top-right (legend toggle, range, …). */
  aside?: React.ReactNode;
  /** When true, render the shimmering placeholder instead of children. */
  loading?: boolean;
  /** When true (and not loading), render the empty state instead of children. */
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  children?: React.ReactNode;
  className?: string;
}

/**
 * Card shell for a single chart: titled header (+ optional subtitle/aside) and
 * a body that swaps between a shimmer skeleton, a designed empty state, and the
 * chart itself. Server-component friendly — the charts inside are the only
 * client pieces.
 */
export function ChartCard({
  title,
  subtitle,
  aside,
  loading = false,
  empty = false,
  emptyTitle = "No data yet",
  emptyDescription = "This chart will populate as activity comes in.",
  children,
  className,
}: ChartCardProps) {
  return (
    <section
      data-slot="chart-card"
      className={cn(
        "flex flex-col rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm sm:p-5",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {aside ? <div className="shrink-0">{aside}</div> : null}
      </header>

      <div className="mt-4 flex-1">
        {loading ? (
          <ChartCardSkeleton />
        ) : empty ? (
          <EmptyState
            illustration="no-results"
            title={emptyTitle}
            description={emptyDescription}
            className="py-8"
          />
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** Shimmer placeholder shaped like a chart (bars of varied height). */
export function ChartCardSkeleton() {
  const heights = ["40%", "70%", "55%", "85%", "60%", "95%", "50%"];
  return (
    <div aria-hidden className="flex h-40 items-end gap-2">
      {heights.map((h, i) => (
        <Shimmer key={i} className="flex-1 rounded-md" style={{ height: h }} />
      ))}
    </div>
  );
}
