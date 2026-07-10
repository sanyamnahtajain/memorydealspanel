"use client";

/**
 * CategoryFilters — brand facet for a category listing.
 *
 * Desktop: an inline row of toggle chips. Mobile: a "Filters" button that
 * opens a bottom sheet (Vaul-backed Sheet) with the same chips plus apply /
 * clear controls. Selection is reflected into the URL (`?brand=a,b`) so it is
 * shareable and survives navigation; the server page reads it to filter.
 *
 * Carries no pricing — pure faceting UI.
 */

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useIsMobile } from "@/components/common/use-is-mobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
  SheetClose,
} from "@/components/ui/sheet";

interface CategoryFiltersProps {
  /** All brands available in this category. */
  brands: string[];
  /** Currently selected brands (from the URL). */
  selected: string[];
}

function useBrandNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return React.useCallback(
    (brands: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (brands.length > 0) {
        params.set("brand", brands.join(","));
      } else {
        params.delete("brand");
      }
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );
}

export function CategoryFilters({ brands, selected }: CategoryFiltersProps) {
  const isMobile = useIsMobile();
  const navigate = useBrandNavigation();

  if (brands.length === 0) return null;

  const toggle = (brand: string) => {
    const set = new Set(selected);
    if (set.has(brand)) set.delete(brand);
    else set.add(brand);
    navigate(Array.from(set));
  };

  if (isMobile) {
    return (
      <MobileFilters
        brands={brands}
        selected={selected}
        onToggle={toggle}
        onClear={() => navigate([])}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {brands.map((brand) => (
        <BrandChip
          key={brand}
          brand={brand}
          active={selected.includes(brand)}
          onClick={() => toggle(brand)}
        />
      ))}
      {selected.length > 0 ? (
        <button
          type="button"
          onClick={() => navigate([])}
          className="inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden />
          Clear
        </button>
      ) : null}
    </div>
  );
}

function MobileFilters({
  brands,
  selected,
  onToggle,
  onClear,
}: {
  brands: string[];
  selected: string[];
  onToggle: (brand: string) => void;
  onClear: () => void;
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
            {selected.length > 0 ? (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary text-[0.7rem] font-semibold text-primary-foreground">
                {selected.length}
              </span>
            ) : null}
          </button>
        }
      />
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Filter by brand</SheetTitle>
        </SheetHeader>
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {brands.map((brand) => (
            <BrandChip
              key={brand}
              brand={brand}
              active={selected.includes(brand)}
              onClick={() => onToggle(brand)}
            />
          ))}
        </div>
        <SheetFooter className="flex-row gap-3">
          <button
            type="button"
            onClick={onClear}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Clear all
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

function BrandChip({
  brand,
  active,
  onClick,
}: {
  brand: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {brand}
    </button>
  );
}
