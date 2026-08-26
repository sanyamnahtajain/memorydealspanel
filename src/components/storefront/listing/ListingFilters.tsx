"use client";

/**
 * ListingFilters — context-scoped refinements for a listing page (owner
 * request: "if i am on boat brand page, why i am seeing filter for zebronics;
 * and if i am under a category, it should show me brands under filter sheet").
 *
 * Renders INTO the listing toolbar row (via StorefrontListing's `filterSlot`):
 *   - a "Filters" chip opening a bottom Sheet with every facet as tappable
 *     rows WITH counts and an Apply/Clear footer;
 *   - one chip per context refinement (brand chips on a category page,
 *     category chips on a brand page) that toggles instantly.
 *
 * THE CORE RULE lives in the SERVER pages, not here: a category page passes
 * only the brands that actually have visible products in that category, and a
 * brand page passes its categories — never a brand facet. When the context
 * list is empty this renders no context chips at all, and when there is
 * nothing to filter it renders nothing.
 *
 * Selection is URL-driven (`brand` / `cat` / `stock` params — see
 * filter-params.ts) so back/forward and sharing work, and the SERVER re-runs
 * the discovery query for the new params — filtering is never client-side
 * over one loaded page. Carries NO pricing anywhere.
 */

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, SlidersHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";
import type { StockStatus } from "@/lib/schemas/shared";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  CONTEXT_FILTER_PARAMS,
  STOCK_ROW_LABELS,
  parseListParam,
  parseStockParam,
  toggleListValue,
  writeListParam,
} from "./filter-params";

/** One selectable refinement (brand or category), with its product count. */
export interface ContextFacetBucket {
  /** Stable id written to the URL param. */
  value: string;
  /** Customer-visible name. */
  label: string;
  count: number;
}

export interface ListingFiltersProps {
  /**
   * The page's ONE context facet: brands on a category page ("Brand"),
   * categories on a brand page ("Category"). Empty buckets hide it entirely.
   */
  contextFacet?: {
    /** URL param the selection lives in (`brand` or `cat`). */
    param: string;
    /** Section / chip-group title, e.g. "Brand". */
    title: string;
    buckets: ContextFacetBucket[];
  } | null;
  /** Stock counts for this page's scope; omit to hide the stock rows. */
  stockCounts?: ReadonlyArray<{ status: StockStatus; count: number }>;
}

const STOCK_ORDER: readonly StockStatus[] = ["IN_STOCK", "LOW", "OUT_OF_STOCK"];

export function ListingFilters({ contextFacet, stockCounts }: ListingFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = React.useTransition();

  const facet =
    contextFacet && contextFacet.buckets.length > 0 ? contextFacet : null;
  const stock = React.useMemo(
    () =>
      (stockCounts ?? [])
        .slice()
        .sort(
          (a, b) => STOCK_ORDER.indexOf(a.status) - STOCK_ORDER.indexOf(b.status),
        ),
    [stockCounts],
  );

  // URL is the single source of truth for the APPLIED selection.
  const selectedContext = React.useMemo(
    () =>
      facet
        ? parseListParam(new URLSearchParams(searchParams.toString()), facet.param)
        : [],
    [searchParams, facet],
  );
  const selectedStock = React.useMemo(
    () => parseStockParam(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const commit = React.useCallback(
    (context: string[], stockSel: StockStatus[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (facet) writeListParam(params, facet.param, context);
      writeListParam(params, CONTEXT_FILTER_PARAMS.stock, stockSel);
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      });
    },
    [router, pathname, searchParams, facet],
  );

  // ---- Bottom sheet draft (committed on Apply). ----
  const [open, setOpen] = React.useState(false);
  const [draftContext, setDraftContext] = React.useState<string[]>([]);
  const [draftStock, setDraftStock] = React.useState<StockStatus[]>([]);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      // Seed the draft from the applied selection at open time (event handler,
      // never an effect).
      setDraftContext(selectedContext);
      setDraftStock(selectedStock);
    }
    setOpen(next);
  };

  const applyDraft = () => {
    commit(draftContext, draftStock);
    setOpen(false);
  };

  const clearAll = () => {
    setDraftContext([]);
    setDraftStock([]);
    commit([], []);
  };

  const activeCount = selectedContext.length + selectedStock.length;
  const draftCount = draftContext.length + draftStock.length;
  const nothingToFilter = !facet && stock.length === 0;
  if (nothingToFilter) return null;

  return (
    <>
      {/* "Filters" chip -> bottom sheet */}
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetTrigger
          render={
            <button
              type="button"
              className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-card px-4 text-sm font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]"
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              Filters
              {activeCount > 0 ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground">
                  {activeCount}
                </span>
              ) : null}
            </button>
          }
        />
        <SheetContent
          side="bottom"
          className="flex max-h-[85dvh] flex-col rounded-t-2xl"
        >
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-2">
            {facet ? (
              <FacetRowGroup title={facet.title}>
                {facet.buckets.map((bucket) => (
                  <FacetRow
                    key={bucket.value}
                    label={bucket.label}
                    count={bucket.count}
                    active={draftContext.includes(bucket.value)}
                    onToggle={(next) =>
                      setDraftContext((prev) =>
                        toggleListValue(prev, bucket.value, next),
                      )
                    }
                  />
                ))}
              </FacetRowGroup>
            ) : null}

            {stock.length > 0 ? (
              <FacetRowGroup title="Stock">
                {stock.map((bucket) => (
                  <FacetRow
                    key={bucket.status}
                    label={STOCK_ROW_LABELS[bucket.status]}
                    count={bucket.count}
                    active={draftStock.includes(bucket.status)}
                    disabled={
                      bucket.count === 0 && !draftStock.includes(bucket.status)
                    }
                    onToggle={(next) =>
                      setDraftStock((prev) =>
                        toggleListValue(prev, bucket.status, next),
                      )
                    }
                  />
                ))}
              </FacetRowGroup>
            ) : null}
          </div>

          <SheetFooter className="flex-row gap-3">
            <button
              type="button"
              onClick={clearAll}
              disabled={draftCount === 0 && activeCount === 0}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              Clear all
            </button>
            <button
              type="button"
              onClick={applyDraft}
              className="inline-flex min-h-11 flex-[1.4] items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {isPending ? <Spinner size="sm" label="" /> : null}
              Apply
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Context chips — instant toggles, one per available refinement. */}
      {facet
        ? facet.buckets.map((bucket) => {
            const active = selectedContext.includes(bucket.value);
            return (
              <button
                key={bucket.value}
                type="button"
                aria-pressed={active}
                disabled={isPending}
                onClick={() =>
                  commit(
                    toggleListValue(selectedContext, bucket.value, !active),
                    selectedStock,
                  )
                }
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97] disabled:opacity-60",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-foreground shadow-sm hover:bg-muted",
                )}
              >
                {bucket.label}
                {active ? <Check className="size-3.5" aria-hidden /> : null}
              </button>
            );
          })
        : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Sheet building blocks                                               */
/* ------------------------------------------------------------------ */

function FacetRowGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </legend>
      <div className="flex flex-col overflow-hidden rounded-xl border border-border">
        {children}
      </div>
    </fieldset>
  );
}

function FacetRow({
  label,
  count,
  active,
  disabled,
  onToggle,
}: {
  label: string;
  count: number;
  active: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={() => onToggle(!active)}
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 border-b border-border px-4 text-sm outline-none transition-colors last:border-b-0 focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 disabled:opacity-50",
        active
          ? "bg-primary/5 font-semibold text-primary"
          : "text-foreground hover:bg-muted",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "text-xs tabular-nums",
            active ? "text-primary" : "text-muted-foreground",
          )}
        >
          {count.toLocaleString("en-IN")}
        </span>
        {active ? <Check className="size-4" aria-hidden /> : null}
      </span>
    </button>
  );
}
