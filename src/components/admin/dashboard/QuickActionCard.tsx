import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A prominent, fully-clickable dashboard card that surfaces a single actionable
 * count (e.g. "3 access requests waiting") and links to where the admin acts on
 * it. Distinct from the passive {@link StatCard}: this one is a call to action,
 * so it links, hovers, and (optionally) accents when the count is non-zero.
 *
 * Server component — the count arrives pre-formatted.
 */
export interface QuickActionCardProps {
  label: string;
  /** Pre-formatted count, e.g. "3". */
  value: string;
  /** Short caption under the value, e.g. "waiting for review". */
  caption?: string;
  href: string;
  icon?: React.ReactNode;
  /** Label for the trailing link affordance. Defaults to "Review". */
  actionLabel?: string;
  /**
   * When true and the underlying count is non-zero, the card is accented to
   * draw the eye. Pass `false` (or a zero count) for a calm resting state.
   */
  urgent?: boolean;
  className?: string;
}

export function QuickActionCard({
  label,
  value,
  caption,
  href,
  icon,
  actionLabel = "Review",
  urgent = false,
  className,
}: QuickActionCardProps) {
  return (
    <Link
      href={href}
      data-slot="quick-action-card"
      className={cn(
        "group/qa flex items-center gap-4 rounded-xl border p-4 shadow-sm transition-fast",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        urgent
          ? "border-primary/30 bg-primary/5 hover:bg-primary/10"
          : "border-border bg-card hover:bg-muted/50",
        className,
      )}
    >
      {icon ? (
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-lg [&_svg]:size-5",
            urgent
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          {icon}
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {value}
          </span>
          <span className="truncate text-sm font-medium text-foreground">
            {label}
          </span>
        </div>
        {caption ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {caption}
          </p>
        ) : null}
      </div>

      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-0.5 text-xs font-medium transition-fast",
          urgent ? "text-primary" : "text-muted-foreground",
          "group-hover/qa:translate-x-0.5",
        )}
      >
        {actionLabel}
        <ArrowUpRight aria-hidden className="size-3.5" />
      </span>
    </Link>
  );
}
