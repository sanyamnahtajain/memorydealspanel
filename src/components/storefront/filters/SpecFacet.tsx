"use client";

import * as React from "react";

import { FacetSection } from "./FacetSection";
import { FacetCheckbox } from "./FacetCheckbox";
import type { SpecFacet as SpecFacetData } from "./types";

/**
 * Spec facet — one collapsible {@link FacetSection} per spec key (e.g.
 * "Capacity", "Speed"), each a multi-select checklist of values with bounded
 * counts. Selections are keyed by spec key so they round-trip through the
 * `spec.<key>` URL params. Price-free and available to every viewer.
 */
export interface SpecFacetProps {
  facet: SpecFacetData;
  /** Selected values keyed by spec key. */
  selected: Record<string, string[]>;
  onToggle: (specKey: string, value: string, next: boolean) => void;
}

/** Long value lists inside a spec group collapse behind "show all". */
const COLLAPSED_LIMIT = 8;

export function SpecFacet({ facet, selected, onToggle }: SpecFacetProps) {
  if (facet.groups.length === 0) return null;
  return (
    <>
      {facet.groups.map((group) => (
        <SpecGroup
          key={group.key}
          group={group}
          selected={selected[group.key] ?? []}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

function SpecGroup({
  group,
  selected,
  onToggle,
}: {
  group: SpecFacetData["groups"][number];
  selected: string[];
  onToggle: (specKey: string, value: string, next: boolean) => void;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);

  if (group.buckets.length === 0) return null;

  const overflow = group.buckets.length > COLLAPSED_LIMIT;
  const visible = expanded ? group.buckets : group.buckets.slice(0, COLLAPSED_LIMIT);

  return (
    <FacetSection title={group.label} activeCount={selected.length}>
      <div className="max-h-64 space-y-0.5 overflow-y-auto">
        {visible.map((bucket) => (
          <FacetCheckbox
            key={bucket.value}
            checked={selectedSet.has(bucket.value)}
            onChange={(next) => onToggle(group.key, bucket.value, next)}
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
            : `Show all ${group.buckets.length.toLocaleString("en-IN")}`}
        </button>
      ) : null}
    </FacetSection>
  );
}
