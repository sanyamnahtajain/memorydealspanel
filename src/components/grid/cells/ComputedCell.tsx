"use client";

/**
 * ComputedCell — a derived, read-only value produced by `column.compute(row)`.
 *
 * There is NO editor (the registry entry's `Editor` is `null`). The value is
 * recomputed from the whole row on every render, so it stays in sync as its
 * inputs change. `column.format` may post-process the computed result (e.g. a
 * paise result formatted as ₹, or a ratio formatted as "%"). Numeric results
 * are right-aligned with tabular numerals; the cell reads as subtly muted to
 * signal it is not editable.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import type { CellRendererProps } from "./cell-props";

/** Run `column.compute` defensively; returns the derived value or "". */
export function computeValue({
  column,
  row,
}: Pick<CellRendererProps, "column" | "row">): number | string | "" {
  if (!column.compute) return "";
  try {
    return column.compute(row);
  } catch {
    return "";
  }
}

/** Turn a computed result into display text, honoring `column.format`. */
export function computedToDisplay(
  result: number | string | "",
  format?: (value: unknown) => string,
): string {
  if (result === "" || result == null) return "";
  if (format) return format(result);
  if (typeof result === "number") {
    return Number.isFinite(result)
      ? result.toLocaleString("en-IN", { maximumFractionDigits: 2 })
      : "";
  }
  return String(result);
}

export function ComputedRenderer({ column, row, className }: CellRendererProps) {
  const result = computeValue({ column, row });
  const text = computedToDisplay(result, column.format);
  const numeric = typeof result === "number";
  return (
    <span
      data-slot="computed-cell"
      aria-readonly="true"
      className={cn(
        "block truncate text-muted-foreground",
        numeric && "text-right font-tabular tabular-nums",
        className,
      )}
      title={text || undefined}
    >
      {text || " "}
    </span>
  );
}
