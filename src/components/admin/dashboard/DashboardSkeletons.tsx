import * as React from "react";
import { cn } from "@/lib/utils";
import { Shimmer, SkeletonStat } from "@/components/common";
import { ChartCardSkeleton } from "@/components/charts";

/** Skeleton matching the KPI {@link StatGrid} while counts load. */
export function StatGridSkeleton({
  count = 6,
  columns = 3,
  className,
}: {
  count?: number;
  columns?: 3 | 4;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2",
        columns === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
        className,
      )}
    >
      {Array.from({ length: count }, (_, i) => (
        <SkeletonStat key={i} />
      ))}
    </div>
  );
}

/** Skeleton for a titled dashboard panel with a list of rows. */
export function PanelSkeleton({
  rows = 5,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <section
      aria-hidden
      className={cn(
        "rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5",
        className,
      )}
    >
      <Shimmer className="h-4 w-32" />
      <div className="mt-4 flex flex-col gap-4">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Shimmer className="size-9 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Shimmer className="h-3.5 w-3/5" />
              <Shimmer className="h-3 w-2/5" />
            </div>
            <Shimmer className="h-3.5 w-10" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Skeleton for the responsive charts grid while metrics load. */
export function DashboardChartsSkeleton({
  count = 6,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn("grid grid-cols-1 gap-4 lg:grid-cols-2", className)}
    >
      {Array.from({ length: count }, (_, i) => (
        <section
          key={i}
          className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
        >
          <Shimmer className="h-4 w-40" />
          <Shimmer className="mt-1.5 h-3 w-28" />
          <div className="mt-4">
            <ChartCardSkeleton />
          </div>
        </section>
      ))}
    </div>
  );
}
