"use client";

/**
 * ListingControls — the stock filter + sort controls for the listing.
 *
 * Desktop: inline custom segmented chips (stock) and a custom sort menu.
 * Mobile: a single "Filter & sort" button that opens a bottom Sheet with the
 * same controls plus apply/clear. Never a native <select> / <option>.
 *
 * Carries NO pricing. The price-sort options are only OFFERED when
 * `canSortPrice` is true (approved viewer) — a gated viewer never sees them,
 * consistent with the price gate.
 */

import * as React from "react";
import { ArrowUpDown, Check, SlidersHorizontal } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SORT_LABELS,
  STOCK_FILTERS,
  STOCK_LABELS,
  type SortKey,
  type StockFilter,
} from "./types";

interface ListingControlsProps {
  stock: StockFilter;
  sort: SortKey;
  onStock: (value: StockFilter) => void;
  onSort: (value: SortKey) => void;
  /** Whether price sort options are shown (approved viewer). */
  canSortPrice: boolean;
}

/** Sort keys offered given price-visibility. */
function sortOptions(canSortPrice: boolean): SortKey[] {
  return canSortPrice
    ? ["newest", "name", "price-asc", "price-desc"]
    : ["newest", "name"];
}

export function ListingControls(props: ListingControlsProps) {
  const isMobile = useIsMobile();
  if (isMobile) return <MobileControls {...props} />;
  return <DesktopControls {...props} />;
}

/* ------------------------------------------------------------------ */
/* Desktop                                                             */
/* ------------------------------------------------------------------ */

function DesktopControls({
  stock,
  sort,
  onStock,
  onSort,
  canSortPrice,
}: ListingControlsProps) {
  const options = sortOptions(canSortPrice);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StockChips stock={stock} onStock={onStock} />
      <div className="ml-auto flex items-center gap-1.5">
        <ArrowUpDown className="size-4 text-muted-foreground" aria-hidden />
        <Select
          value={sort}
          onValueChange={(v) => onSort(v as SortKey)}
        >
          <SelectTrigger
            aria-label="Sort products"
            className="h-9 w-[11.5rem] rounded-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((key) => (
              <SelectItem key={key} value={key}>
                {SORT_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function StockChips({
  stock,
  onStock,
}: {
  stock: StockFilter;
  onStock: (value: StockFilter) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Stock" className="flex flex-wrap items-center gap-1.5">
      {STOCK_FILTERS.map((value) => {
        const active = value === stock;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onStock(value)}
            className={cn(
              "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {STOCK_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Mobile (bottom sheet)                                               */
/* ------------------------------------------------------------------ */

function MobileControls({
  stock,
  sort,
  onStock,
  onSort,
  canSortPrice,
}: ListingControlsProps) {
  const options = sortOptions(canSortPrice);
  const isDefault = stock === "all" && sort === "newest";

  return (
    <Sheet>
      <SheetTrigger
        render={
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            Filter &amp; sort
            {!isDefault ? (
              <span className="inline-flex size-2 rounded-full bg-primary" aria-hidden />
            ) : null}
          </button>
        }
      />
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Filter &amp; sort</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 px-4 pb-2">
          <fieldset>
            <legend className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Stock
            </legend>
            <div className="flex flex-wrap gap-2">
              {STOCK_FILTERS.map((value) => {
                const active = value === stock;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onStock(value)}
                    className={cn(
                      "inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {STOCK_LABELS[value]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Sort by
            </legend>
            <div className="flex flex-col overflow-hidden rounded-xl border border-border">
              {options.map((key) => {
                const active = key === sort;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSort(key)}
                    className={cn(
                      "flex min-h-11 items-center justify-between border-b border-border px-4 text-sm outline-none transition-colors last:border-b-0 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
                      active
                        ? "bg-primary/5 font-semibold text-primary"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    {SORT_LABELS[key]}
                    {active ? <Check className="size-4" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        </div>

        <SheetFooter className="flex-row gap-3">
          <button
            type="button"
            onClick={() => {
              onStock("all");
              onSort("newest");
            }}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Reset
          </button>
          <SheetClose
            render={
              <button
                type="button"
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Show results
              </button>
            }
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
