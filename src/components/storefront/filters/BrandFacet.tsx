"use client";

import * as React from "react";
import { Search } from "lucide-react";

import { FacetSection } from "./FacetSection";
import { FacetCheckbox } from "./FacetCheckbox";
import type { BrandFacet as BrandFacetData } from "./types";

/**
 * Brand facet — a multi-select checklist of brands (with bounded counts) from
 * the aggregated {@link BrandFacetData}. When the brand list is long a small
 * type-ahead filter narrows the visible options (client-side over the already
 * price-free bucket labels). Carries NO pricing.
 */
export interface BrandFacetProps {
  facet: BrandFacetData;
  selected: string[];
  onToggle: (value: string, next: boolean) => void;
}

/** Show the search box once the brand list exceeds this length. */
const SEARCH_THRESHOLD = 8;

export function BrandFacet({ facet, selected, onToggle }: BrandFacetProps) {
  const [query, setQuery] = React.useState("");
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  const buckets = facet.buckets;
  if (buckets.length === 0) return null;

  const q = query.trim().toLowerCase();
  const visible = q
    ? buckets.filter((b) => b.label.toLowerCase().includes(q))
    : buckets;

  return (
    <FacetSection title="Brand" activeCount={selected.length}>
      {buckets.length > SEARCH_THRESHOLD ? (
        <div className="relative mb-1.5 px-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a brand"
            aria-label="Filter brands"
            className="h-8 w-full rounded-lg border border-input bg-background pr-2 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </div>
      ) : null}

      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            No brands match “{query}”.
          </p>
        ) : (
          visible.map((bucket) => (
            <FacetCheckbox
              key={bucket.value}
              checked={selectedSet.has(bucket.value)}
              onChange={(next) => onToggle(bucket.value, next)}
              label={bucket.label}
              count={bucket.count}
              disabled={bucket.count === 0 && !selectedSet.has(bucket.value)}
            />
          ))
        )}
      </div>
    </FacetSection>
  );
}
