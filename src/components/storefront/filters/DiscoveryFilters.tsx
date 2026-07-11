"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/components/common/use-is-mobile";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SlidersHorizontal } from "lucide-react";

import { ActiveFilterChips } from "./ActiveFilterChips";
import { BrandFacet } from "./BrandFacet";
import { SpecFacet } from "./SpecFacet";
import { StockFacet } from "./StockFacet";
import { TagFacet } from "./TagFacet";
import { PriceBandFacet } from "./PriceBandFacet";
import { useFacetSelection } from "./useFacetSelection";
import type { FacetData } from "./types";

/**
 * DiscoveryFilters — the single integration surface for the facet system.
 *
 * It owns ONE {@link useFacetSelection} instance (URL-backed) and renders both
 * the desktop sidebar rail (or mobile Filters sheet) AND the active-filter
 * chip row from that same state, so removing a chip and toggling a facet stay
 * in sync. The chips render inline above the results; the rail renders in a
 * `sidebar` slot alongside them.
 *
 * THE PRICE GATE: `facets.priceBands.approved` (server-computed) is the only
 * signal that unlocks the price band picker; for gated viewers the band param
 * is never parsed or written and the "Log in to filter by price" chip is shown
 * in its place. No amount ever reaches a gated client.
 *
 * Usage: render `<DiscoveryFilters facets={...}>` returns `{ sidebar, chips }`
 * via render-prop is avoided — instead callers place this component and read
 * its two visual regions through the `slot` prop. To keep composition simple
 * we expose the whole thing and let the parent decide layout by passing the
 * results as `children`.
 */
export interface DiscoveryFiltersProps {
  facets: FacetData;
  /** The results region (listing) rendered to the right of the rail. */
  children: React.ReactNode;
  /** Total filtered result count (for the mobile CTA + chip context). */
  resultCount?: number;
}

/** Stacked facet controls shared by the desktop rail and mobile sheet. */
function FacetBody({
  facets,
  api,
}: {
  facets: FacetData;
  api: ReturnType<typeof useFacetSelection>;
}) {
  return (
    <div className="flex flex-col">
      <BrandFacet
        facet={facets.brand}
        selected={api.selection.brands}
        onToggle={api.toggleBrand}
      />
      <PriceBandFacet
        facet={facets.priceBands}
        selected={api.selection.band}
        onSelect={api.setBand}
      />
      <StockFacet
        facet={facets.stock}
        selected={api.selection.stock}
        onToggle={api.toggleStock}
      />
      <SpecFacet
        facet={facets.specs}
        selected={api.selection.specs}
        onToggle={api.toggleSpec}
      />
      <TagFacet
        facet={facets.tags}
        selected={api.selection.tags}
        onToggle={api.toggleTag}
      />
    </div>
  );
}

export function DiscoveryFilters({
  facets,
  children,
  resultCount,
}: DiscoveryFiltersProps) {
  const isMobile = useIsMobile();
  const api = useFacetSelection(facets.priceBands.approved);

  const chips = (
    <ActiveFilterChips
      facets={facets}
      selection={api.selection}
      onRemoveBrand={api.removeBrand}
      onRemoveSpec={api.removeSpec}
      onRemoveStock={api.removeStock}
      onRemoveTag={api.removeTag}
      onRemoveBand={api.removeBand}
      onClearAll={api.clearAll}
    />
  );

  return (
    <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
      {/* Desktop rail */}
      {!isMobile ? (
        <aside className="w-64 shrink-0" aria-label="Product filters">
          <div className="sticky top-20">
            <div className="mb-1 flex items-center justify-between px-1">
              <h2 className="text-sm font-semibold text-foreground">Filters</h2>
              {api.activeCount > 0 ? (
                <button
                  type="button"
                  onClick={api.clearAll}
                  className="rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  Clear all
                </button>
              ) : null}
            </div>
            <div className="rounded-xl border border-border bg-card px-3">
              <FacetBody facets={facets} api={api} />
            </div>
          </div>
        </aside>
      ) : null}

      {/* Results column */}
      <div className="min-w-0 flex-1">
        {/* Mobile trigger + chips row */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {isMobile ? (
            <MobileFilterTrigger
              facets={facets}
              api={api}
              resultCount={resultCount}
            />
          ) : null}
          {chips}
        </div>
        {children}
      </div>
    </div>
  );
}

function MobileFilterTrigger({
  facets,
  api,
  resultCount,
}: {
  facets: FacetData;
  api: ReturnType<typeof useFacetSelection>;
  resultCount?: number;
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filters
            {api.activeCount > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground">
                {api.activeCount}
              </span>
            ) : null}
          </button>
        }
      />
      <SheetContent
        side="bottom"
        className={cn("flex max-h-[85dvh] flex-col rounded-t-2xl")}
      >
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <FacetBody facets={facets} api={api} />
        </div>

        <SheetFooter className="flex-row gap-3">
          <button
            type="button"
            onClick={api.clearAll}
            disabled={api.activeCount === 0}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            Reset
          </button>
          <SheetClose
            render={
              <button
                type="button"
                className="inline-flex min-h-11 flex-[1.4] items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {typeof resultCount === "number"
                  ? `Show ${resultCount.toLocaleString("en-IN")} ${
                      resultCount === 1 ? "result" : "results"
                    }`
                  : "Show results"}
              </button>
            }
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
