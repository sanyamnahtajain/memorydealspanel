"use client";

import * as React from "react";
import { X } from "lucide-react";

import type { StockStatus } from "@/lib/schemas/shared";
import { cn } from "@/lib/utils";
import type { FacetData, FacetSelection } from "./types";

/**
 * Active-filter chips — a removable pill per applied facet selection, plus a
 * "Clear all" affordance. Labels are resolved from the facet buckets so a chip
 * reads the human label ("SanDisk") rather than the raw slug. The price band
 * label comes straight from the (already-authorised) band bucket, so no
 * pricing is ever formatted client-side. Renders nothing when no facet is
 * active.
 */
export interface ActiveFilterChipsProps {
  facets: FacetData;
  selection: FacetSelection;
  onRemoveBrand: (value: string) => void;
  onRemoveSpec: (specKey: string, value: string) => void;
  onRemoveStock: (value: StockStatus) => void;
  onRemoveTag: (value: string) => void;
  onRemoveBand: () => void;
  onClearAll: () => void;
}

interface Chip {
  key: string;
  label: string;
  onRemove: () => void;
}

const STOCK_LABELS: Record<StockStatus, string> = {
  IN_STOCK: "In stock",
  LOW: "Low stock",
  OUT_OF_STOCK: "Out of stock",
};

export function ActiveFilterChips({
  facets,
  selection,
  onRemoveBrand,
  onRemoveSpec,
  onRemoveStock,
  onRemoveTag,
  onRemoveBand,
  onClearAll,
}: ActiveFilterChipsProps) {
  const chips = React.useMemo<Chip[]>(() => {
    const out: Chip[] = [];

    const brandLabel = (value: string) =>
      facets.brand.buckets.find((b) => b.value === value)?.label ?? value;
    for (const value of selection.brands) {
      out.push({
        key: `brand:${value}`,
        label: brandLabel(value),
        onRemove: () => onRemoveBrand(value),
      });
    }

    for (const [specKey, values] of Object.entries(selection.specs)) {
      const group = facets.specs.groups.find((g) => g.key === specKey);
      for (const value of values) {
        const label =
          group?.buckets.find((b) => b.value === value)?.label ?? value;
        const prefix = group?.label ? `${group.label}: ` : "";
        out.push({
          key: `spec:${specKey}:${value}`,
          label: `${prefix}${label}`,
          onRemove: () => onRemoveSpec(specKey, value),
        });
      }
    }

    for (const value of selection.stock) {
      out.push({
        key: `stock:${value}`,
        label: STOCK_LABELS[value],
        onRemove: () => onRemoveStock(value),
      });
    }

    for (const value of selection.tags) {
      const label =
        facets.tags.buckets.find((b) => b.value === value)?.label ?? value;
      out.push({
        key: `tag:${value}`,
        label,
        onRemove: () => onRemoveTag(value),
      });
    }

    // Price band chip — only if approved AND a band is selected. The label is
    // the server-rendered band string (no client-side amount formatting).
    if (selection.band && facets.priceBands.approved) {
      const band = facets.priceBands.bands.find(
        (b) => b.value === selection.band,
      );
      if (band) {
        out.push({
          key: `band:${band.value}`,
          label: band.label,
          onRemove: onRemoveBand,
        });
      }
    }

    return out;
  }, [
    facets,
    selection,
    onRemoveBrand,
    onRemoveSpec,
    onRemoveStock,
    onRemoveTag,
    onRemoveBand,
  ]);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={chip.onRemove}
          className={cn(
            "group inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border border-border bg-card py-1 pr-2 pl-3 text-xs font-medium text-foreground outline-none transition-colors",
            "hover:border-primary/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        >
          <span className="truncate">{chip.label}</span>
          <span
            aria-hidden
            className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary"
          >
            <X className="size-3" strokeWidth={2.5} />
          </span>
          <span className="sr-only">Remove filter {chip.label}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="rounded-full px-2.5 py-1 text-xs font-semibold text-muted-foreground underline-offset-2 outline-none transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Clear all
      </button>
    </div>
  );
}
