"use client";

import * as React from "react";

import type { StockStatus } from "@/lib/schemas/shared";
import { FacetSection } from "./FacetSection";
import { FacetCheckbox } from "./FacetCheckbox";
import type { StockFacet as StockFacetData } from "./types";

/** Human labels for the stock statuses (price-free). */
const STOCK_LABELS: Record<StockStatus, string> = {
  IN_STOCK: "In stock",
  LOW: "Low stock",
  OUT_OF_STOCK: "Out of stock",
};

/**
 * Stock facet — multi-select over the three stock statuses, each with its
 * aggregated count. Price-free and available to every viewer.
 */
export interface StockFacetProps {
  facet: StockFacetData;
  selected: StockStatus[];
  onToggle: (value: StockStatus, next: boolean) => void;
}

export function StockFacet({ facet, selected, onToggle }: StockFacetProps) {
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  if (facet.buckets.length === 0) return null;

  return (
    <FacetSection title="Availability" activeCount={selected.length}>
      {facet.buckets.map((bucket) => (
        <FacetCheckbox
          key={bucket.value}
          checked={selectedSet.has(bucket.value)}
          onChange={(next) => onToggle(bucket.value, next)}
          label={STOCK_LABELS[bucket.value]}
          count={bucket.count}
          disabled={bucket.count === 0 && !selectedSet.has(bucket.value)}
        />
      ))}
    </FacetSection>
  );
}
