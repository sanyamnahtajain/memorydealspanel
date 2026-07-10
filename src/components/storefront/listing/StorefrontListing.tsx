"use client";

/**
 * StorefrontListing — the headline listing experience.
 *
 * Orchestrates:
 *   - the {@link ViewModeSwitcher} (grid / compact / table), seeded from
 *     `usePreferences().defaultViewMode` and persisting changes back to it;
 *   - {@link ListingControls} — a stock filter + sort, custom controls
 *     (inline on desktop, bottom Sheet on mobile), URL-param persisted;
 *   - a result count;
 *   - {@link LoadMoreButton} cursor pagination that calls a server action
 *     (`loadMore`) which re-queries via the viewer-aware DAL so the price gate
 *     is preserved for every appended page.
 *
 * PRICE GATE: every item is a {@link ListingItem} with a `product`
 * (PublicProduct — no money) and a server-built `priceSlot` (the real price
 * for approved viewers, the locked chip otherwise). This client component
 * never reads a price. Price SORT is only available when `canSortPrice` is
 * true; the ordering then uses each item's `priceSortKey`, which is present
 * only for approved viewers (see {@link ListingItem}).
 *
 * `stock` filter and `sort` are applied on the client over the items loaded so
 * far. Load-more always fetches the DAL's default newest-first order; the
 * chosen sort re-orders the accumulated set. This keeps every page gated while
 * giving instant, no-round-trip re-sorting.
 */

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { EmptyState } from "@/components/common/EmptyState";
import {
  usePreferences,
  type ViewMode,
} from "@/components/preferences/PreferencesProvider";
import { ViewModeSwitcher } from "./ViewModeSwitcher";
import { ListingControls } from "./ListingControls";
import { LoadMoreButton } from "./LoadMoreButton";
import { ProductGridView } from "./ProductGridView";
import { ProductCompactView } from "./ProductCompactView";
import { ProductTableView } from "./ProductTableView";
import {
  isSortKey,
  isStockFilter,
  VIEW_MODES,
  type ListingItem,
  type LoadMoreFn,
  type SortKey,
  type StockFilter,
} from "./types";

interface StorefrontListingProps {
  initialItems: ListingItem[];
  /** Server action to fetch subsequent pages (already gated). */
  loadMore?: LoadMoreFn;
  /** Server page size; a short page signals the end of the list. */
  pageSize: number;
  /** Page already rendered as `initialItems` (1-based). */
  initialPage?: number;
  /** Whether the current viewer may see/sort prices (approved). */
  canSeePrices: boolean;
  /** Total result count, when known (for the count line). */
  total?: number;
  emptyTitle?: string;
  emptyDescription?: string;
}

function isViewMode(value: unknown): value is ViewMode {
  return (VIEW_MODES as readonly string[]).includes(value as string);
}

export function StorefrontListing({
  initialItems,
  loadMore,
  pageSize,
  initialPage = 1,
  canSeePrices,
  total,
  emptyTitle = "No products here yet",
  emptyDescription = "Check back soon — we're adding stock regularly.",
}: StorefrontListingProps) {
  const prefs = usePreferences();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ---- View / filter / sort state, seeded from URL, then preferences. ----
  const urlView = searchParams.get("view");
  const urlStock = searchParams.get("stock");
  const urlSort = searchParams.get("sort");

  const [viewMode, setViewMode] = React.useState<ViewMode>(() =>
    isViewMode(urlView) ? urlView : prefs.defaultViewMode,
  );
  const [stock, setStock] = React.useState<StockFilter>(() =>
    isStockFilter(urlStock) ? urlStock : "all",
  );
  const [sort, setSort] = React.useState<SortKey>(() => {
    if (isSortKey(urlSort)) {
      // Never honour a price sort from the URL for a gated viewer.
      if ((urlSort === "price-asc" || urlSort === "price-desc") && !canSeePrices) {
        return "newest";
      }
      return urlSort;
    }
    return "newest";
  });

  // ---- Pagination state. ----
  const [appended, setAppended] = React.useState<ListingItem[]>([]);
  const [page, setPage] = React.useState(initialPage);
  const [pending, setPending] = React.useState(false);
  const [exhausted, setExhausted] = React.useState(false);
  // React's blessed reset-on-prop-change: adjust state during render when the
  // base list identity changes (e.g. new category / new search).
  const [baseline, setBaseline] = React.useState(initialItems);
  if (baseline !== initialItems) {
    setBaseline(initialItems);
    setAppended([]);
    setPage(initialPage);
    setExhausted(false);
  }

  // ---- Persist view / stock / sort into the URL (shareable, back-safe). ----
  const writeUrl = React.useCallback(
    (patch: { view?: ViewMode; stock?: StockFilter; sort?: SortKey }) => {
      const params = new URLSearchParams(searchParams.toString());
      const set = (key: string, value: string, dflt: string) => {
        if (value === dflt) params.delete(key);
        else params.set(key, value);
      };
      if (patch.view !== undefined) set("view", patch.view, "grid");
      if (patch.stock !== undefined) set("stock", patch.stock, "all");
      if (patch.sort !== undefined) set("sort", patch.sort, "newest");
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const changeView = (mode: ViewMode) => {
    setViewMode(mode);
    writeUrl({ view: mode });
  };
  const changeStock = (value: StockFilter) => {
    setStock(value);
    writeUrl({ stock: value });
  };
  const changeSort = (value: SortKey) => {
    // Guard: never apply a price sort for a gated viewer.
    if ((value === "price-asc" || value === "price-desc") && !canSeePrices) return;
    setSort(value);
    writeUrl({ sort: value });
  };

  const items = React.useMemo(
    () => [...initialItems, ...appended],
    [initialItems, appended],
  );

  const done = exhausted || !loadMore || initialItems.length < pageSize;

  const handleLoadMore = React.useCallback(async () => {
    if (!loadMore || pending || done) return;
    setPending(true);
    try {
      const next = page + 1;
      const rows = await loadMore(next);
      setAppended((prev) => [...prev, ...rows]);
      setPage(next);
      if (rows.length < pageSize) setExhausted(true);
    } catch {
      // Leave the button visible so the user can retry.
    } finally {
      setPending(false);
    }
  }, [loadMore, pending, done, page, pageSize]);

  // ---- Client-side stock filter + sort over the accumulated set. ----
  const visible = React.useMemo(() => {
    let out = items;
    if (stock !== "all") {
      out = out.filter((it) => it.product.stockStatus === stock);
    }
    if (sort === "name") {
      out = [...out].sort((a, b) =>
        a.product.name.localeCompare(b.product.name, undefined, {
          sensitivity: "base",
        }),
      );
    } else if (
      (sort === "price-asc" || sort === "price-desc") &&
      canSeePrices
    ) {
      const dir = sort === "price-asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const av = a.priceSortKey ?? Number.POSITIVE_INFINITY;
        const bv = b.priceSortKey ?? Number.POSITIVE_INFINITY;
        return (av - bv) * dir;
      });
    }
    // "newest" keeps the DAL's server order (already newest-first).
    return out;
  }, [items, stock, sort, canSeePrices]);

  const compactDensity = prefs.density === "compact";
  const resultCount = visible.length;

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <p
            className="text-sm text-muted-foreground"
            aria-live="polite"
            role="status"
          >
            {formatCount(resultCount, total, stock !== "all")}
          </p>
          <div className="ml-auto">
            <ViewModeSwitcher value={viewMode} onChange={changeView} />
          </div>
        </div>
        <ListingControls
          stock={stock}
          sort={sort}
          onStock={changeStock}
          onSort={changeSort}
          canSortPrice={canSeePrices}
        />
      </div>

      {/* Results */}
      {items.length === 0 ? (
        <EmptyState
          illustration="empty-box"
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          illustration="no-results"
          title="No products match this filter"
          description="Try a different stock filter to see more products."
        />
      ) : (
        <ListingBody
          viewMode={viewMode}
          items={visible}
          compactDensity={compactDensity}
          sort={sort}
          onSort={changeSort}
          canSortPrice={canSeePrices}
        />
      )}

      {items.length > 0 ? (
        <LoadMoreButton
          hasMore={!done}
          pending={pending}
          onLoadMore={() => void handleLoadMore()}
          disableAutoLoad={prefs.reduceMotion}
        />
      ) : null}
    </div>
  );
}

function ListingBody({
  viewMode,
  items,
  compactDensity,
  sort,
  onSort,
  canSortPrice,
}: {
  viewMode: ViewMode;
  items: ListingItem[];
  compactDensity: boolean;
  sort: SortKey;
  onSort: (key: SortKey) => void;
  canSortPrice: boolean;
}) {
  switch (viewMode) {
    case "table":
      return (
        <ProductTableView
          items={items}
          sort={sort}
          onSort={onSort}
          canSortPrice={canSortPrice}
        />
      );
    case "compact":
      return <ProductCompactView items={items} compactDensity={compactDensity} />;
    case "grid":
    default:
      return <ProductGridView items={items} compactDensity={compactDensity} />;
  }
}

function formatCount(shown: number, total: number | undefined, filtered: boolean): string {
  const n = filtered || total === undefined ? shown : total;
  const noun = n === 1 ? "product" : "products";
  return `${n.toLocaleString("en-IN")} ${noun}`;
}
