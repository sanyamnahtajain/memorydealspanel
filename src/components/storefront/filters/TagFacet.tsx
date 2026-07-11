"use client";

import * as React from "react";

import { FacetSection } from "./FacetSection";
import { FacetCheckbox } from "./FacetCheckbox";
import type { TagFacet as TagFacetData } from "./types";

/**
 * Tag facet — a multi-select checklist of catalogue tags with bounded counts.
 * Long lists are capped with a "show more" toggle to keep the panel compact.
 * Price-free and available to every viewer.
 */
export interface TagFacetProps {
  facet: TagFacetData;
  selected: string[];
  onToggle: (value: string, next: boolean) => void;
}

/** Initial number of tags shown before "Show all". */
const COLLAPSED_LIMIT = 10;

export function TagFacet({ facet, selected, onToggle }: TagFacetProps) {
  const [expanded, setExpanded] = React.useState(false);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  const buckets = facet.buckets;
  if (buckets.length === 0) return null;

  const overflow = buckets.length > COLLAPSED_LIMIT;
  const visible = expanded ? buckets : buckets.slice(0, COLLAPSED_LIMIT);

  return (
    <FacetSection title="Tags" activeCount={selected.length}>
      <div className="space-y-0.5">
        {visible.map((bucket) => (
          <FacetCheckbox
            key={bucket.value}
            checked={selectedSet.has(bucket.value)}
            onChange={(next) => onToggle(bucket.value, next)}
            label={bucket.label}
            count={bucket.count}
            disabled={bucket.count === 0 && !selectedSet.has(bucket.value)}
          />
        ))}
      </div>
      {overflow ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-primary outline-none transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {expanded
            ? "Show fewer"
            : `Show all ${buckets.length.toLocaleString("en-IN")}`}
        </button>
      ) : null}
    </FacetSection>
  );
}
