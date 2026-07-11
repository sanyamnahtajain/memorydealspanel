"use client";

import * as React from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

import { FacetSection } from "./FacetSection";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PriceBandFacet as PriceBandFacetData } from "./types";

/**
 * Price-band facet — the ONLY gated facet.
 *
 * THE PRICE GATE IS SACRED. This component renders a working, single-select
 * band picker (with counts) ONLY when the server-supplied facet says
 * `approved === true`. For every other viewer it renders a "Log in to filter
 * by price" chip that links to /account/login — NEVER a slider, band, or count.
 * The discriminated union on {@link PriceBandFacetData} makes it a type error
 * to read `bands` without proving `approved`, so a gated branch cannot leak an
 * amount even by mistake.
 *
 * The band selection is single-select (a price range is exclusive); clicking
 * the active band clears it.
 */
export interface PriceBandFacetProps {
  facet: PriceBandFacetData;
  /** Selected band id (approved viewers only). */
  selected: string | null;
  onSelect: (value: string | null) => void;
}

export function PriceBandFacet({ facet, selected, onSelect }: PriceBandFacetProps) {
  // GATED VIEWER — render the locked chip, never a working control.
  if (!facet.approved) {
    return (
      <FacetSection title="Price">
        <Tooltip content="Approved buyers can filter by trade price band.">
          <Link
            href="/account/login"
            className="group inline-flex items-center gap-2 rounded-full border border-dashed border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:border-primary/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Lock className="size-3.5" aria-hidden />
            Log in to filter by price
          </Link>
        </Tooltip>
      </FacetSection>
    );
  }

  // APPROVED VIEWER — bands with counts (single-select).
  if (facet.bands.length === 0) return null;

  return (
    <FacetSection title="Price" activeCount={selected ? 1 : 0}>
      <div
        role="radiogroup"
        aria-label="Price band"
        className="flex flex-col gap-0.5"
      >
        {facet.bands.map((band) => {
          const active = band.value === selected;
          return (
            <button
              key={band.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={band.count === 0 && !active}
              onClick={() => onSelect(active ? null : band.value)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm outline-none transition-colors",
                "hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50",
                "disabled:pointer-events-none disabled:opacity-45",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                  active
                    ? "border-primary"
                    : "border-input group-hover:border-muted-foreground",
                )}
              >
                {active ? (
                  <span className="size-2 rounded-full bg-primary" />
                ) : null}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  active ? "font-medium text-foreground" : "text-foreground/90",
                )}
              >
                {band.label}
              </span>
              <span
                className={cn(
                  "shrink-0 text-xs tabular-nums",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {band.count.toLocaleString("en-IN")}
              </span>
            </button>
          );
        })}
      </div>
    </FacetSection>
  );
}
