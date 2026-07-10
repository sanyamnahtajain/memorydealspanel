import * as React from "react";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SkeletonStat } from "./Skeletons";

interface StatCardProps {
  label: string;
  /** Pre-formatted display value (e.g. "₹4,20,500" or 128). */
  value: string | number;
  /**
   * Percentage change vs the previous period. Positive renders green/up,
   * negative renders red/down, zero renders a neutral dash.
   */
  delta?: number;
  /** Context for the delta, e.g. "vs last week". */
  deltaLabel?: string;
  /** Icon slot, rendered top-right in a tinted square. */
  icon?: React.ReactNode;
  /** Renders the shimmering skeleton variant instead of content. */
  skeleton?: boolean;
  className?: string;
}

/**
 * Dashboard KPI card. Server component; values arrive pre-formatted so no
 * client JS is needed. Numbers use tabular numerals.
 */
export function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  icon,
  skeleton = false,
  className,
}: StatCardProps) {
  if (skeleton) {
    return <SkeletonStat className={className} />;
  }

  const direction = delta === undefined ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";

  return (
    <div
      data-slot="stat-card"
      className={cn(
        "rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
        {icon ? (
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground [&_svg]:size-4"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <p className="mt-2 font-tabular text-2xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {direction !== null ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-tabular font-medium",
              direction === "up" && "text-success",
              direction === "down" && "text-destructive",
              direction === "flat" && "text-muted-foreground"
            )}
          >
            {direction === "up" ? (
              <TrendingUpIcon className="size-3.5" aria-hidden />
            ) : direction === "down" ? (
              <TrendingDownIcon className="size-3.5" aria-hidden />
            ) : (
              <MinusIcon className="size-3.5" aria-hidden />
            )}
            {delta !== undefined && delta > 0 ? "+" : ""}
            {delta}%
          </span>
          {deltaLabel ? <span className="text-muted-foreground">{deltaLabel}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
