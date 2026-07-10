"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Stagger } from "@/components/motion/primitives";
import { StatCard } from "@/components/common";

/**
 * A single KPI cell descriptor consumed by {@link StatGrid}. The value is
 * pre-formatted on the server (StatCard renders it verbatim) so no client-side
 * number formatting is required.
 */
export interface StatItem {
  /** Stable key for React reconciliation. */
  key: string;
  label: string;
  /** Pre-formatted display value (e.g. "1,240"). */
  value: string | number;
  /** lucide icon node, rendered in the tinted square. */
  icon?: React.ReactNode;
  /** Optional signed percentage delta vs. a previous period. */
  delta?: number;
  /** Context label for the delta, e.g. "vs last week". */
  deltaLabel?: string;
}

interface StatGridProps {
  items: StatItem[];
  /**
   * Column count at the widest breakpoint. Defaults to 4. The grid always
   * flows 1 → 2 → N as width allows.
   */
  columns?: 3 | 4;
  /** Delay before the stagger begins, in seconds. */
  delay?: number;
  className?: string;
}

/**
 * Responsive KPI grid with a staggered entrance. Presentational only — all
 * counts are resolved on the server and passed in pre-formatted.
 *
 * `Stagger` wraps each direct child in a motion item, so those wrappers become
 * the grid cells: the grid CSS lives on the Stagger container itself.
 */
export function StatGrid({ items, columns = 4, delay = 0, className }: StatGridProps) {
  return (
    <Stagger
      delay={delay}
      className={cn(
        "grid grid-cols-1 gap-4 sm:grid-cols-2",
        columns === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3",
        className,
      )}
      itemClassName="min-w-0"
    >
      {items.map((item) => (
        <StatCard
          key={item.key}
          label={item.label}
          value={item.value}
          icon={item.icon}
          delta={item.delta}
          deltaLabel={item.deltaLabel}
        />
      ))}
    </Stagger>
  );
}
