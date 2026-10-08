"use client";

/**
 * ProductCardGrid — the storefront's product listing surface.
 *
 * PRICE-GATE CONTRACT: this component NEVER receives raw price fields and
 * never formats money itself. The price area of every card is a pre-rendered
 * `priceSlot` React node produced on the server by `<PriceGateCard>` (which
 * decides, per viewer, between an animated PriceReveal and a locked shimmer
 * pill). For anon / pending / expired viewers the slot is a locked chip and
 * no amount ever crosses into this client component.
 *
 * Pagination is "load more": an optional server action returns the next page
 * as ready-to-render `ProductCardItem`s (price slots already resolved server
 * side). An IntersectionObserver auto-loads as the sentinel nears the
 * viewport, with an explicit button fallback.
 *
 * The card is the shared {@link ProductCard}; this file owns the grid, the
 * client-side brand filter and the pagination.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "motion/react";

import type { PublicProduct } from "@/server/dto/product";
import { EmptyState } from "@/components/common/EmptyState";
import { InCartChip } from "@/components/storefront/cart/InCartChip";
import { VariantQuickSheet } from "@/components/storefront/VariantQuickSheet";
import { ProductCard } from "@/components/storefront/product/ProductCard";
import { staggerItemVariants } from "@/components/motion/primitives";
import { useEntranceInitial } from "@/components/motion/useEntrance";
import { hapticTap } from "@/lib/haptics";

/**
 * A single card's data. `product` is always the viewer-projected
 * {@link PublicProduct} (no money). `priceSlot` is the server-rendered price
 * UI for this product and this viewer.
 */
export interface ProductCardItem {
  product: PublicProduct;
  priceSlot: React.ReactNode;
}

/**
 * Loads the next page of items. Returns an empty array when exhausted.
 * Implemented as a server action on the pages so price slots stay server-side.
 */
export type LoadMoreFn = (nextPage: number) => Promise<ProductCardItem[]>;

interface ProductCardGridProps {
  initialItems: ProductCardItem[];
  /** Server action to fetch subsequent pages. Omit to disable pagination. */
  loadMore?: LoadMoreFn;
  /** Page size the server uses; when a page returns fewer, we stop. */
  pageSize: number;
  /** The page number already rendered as `initialItems` (1-based). */
  initialPage?: number;
  className?: string;
  /**
   * Client-side brand filter. When non-empty, only cards whose product brand
   * is in this set are shown. Faceting only — never affects pricing.
   */
  filterBrands?: string[];
  /** Empty-state copy when there are zero items. */
  emptyTitle?: string;
  emptyDescription?: string;
}

const containerVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};

export function ProductCardGrid({
  initialItems,
  loadMore,
  pageSize,
  initialPage = 1,
  className,
  filterBrands,
  emptyTitle = "No products here yet",
  emptyDescription = "Check back soon — we're adding stock regularly.",
}: ProductCardGridProps) {
  const [appended, setAppended] = React.useState<ProductCardItem[]>([]);
  const [page, setPage] = React.useState(initialPage);
  const [pending, setPending] = React.useState(false);
  const [exhausted, setExhausted] = React.useState(false);
  // Tracks the base list we last reset against. Adjusting state DURING render
  // when it changes is React's blessed alternative to a reset effect (state,
  // not a ref, so it passes the strict react-hooks rules).
  const [baseline, setBaseline] = React.useState(initialItems);
  const reduced = useReducedMotion();
  const entranceInitial = useEntranceInitial("hidden" as const);
  const sentinelRef = React.useRef<HTMLDivElement>(null);

  if (baseline !== initialItems) {
    setBaseline(initialItems);
    setAppended([]);
    setPage(initialPage);
    setExhausted(false);
  }

  const items = React.useMemo(
    () => [...initialItems, ...appended],
    [initialItems, appended],
  );
  const done =
    exhausted || !loadMore || initialItems.length < pageSize;

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

  React.useEffect(() => {
    if (done || !loadMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void handleLoadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [done, loadMore, handleLoadMore]);

  const visible = React.useMemo(() => {
    if (!filterBrands || filterBrands.length === 0) return items;
    const set = new Set(filterBrands);
    return items.filter(
      (item) => item.product.brand !== null && set.has(item.product.brand),
    );
  }, [items, filterBrands]);

  if (items.length === 0) {
    return (
      <EmptyState
        illustration="empty-box"
        title={emptyTitle}
        description={emptyDescription}
      />
    );
  }

  if (visible.length === 0) {
    return (
      <EmptyState
        illustration="no-results"
        title="No matches for these filters"
        description="Try clearing a brand filter to see more products."
      />
    );
  }

  return (
    <div className={className}>
      <motion.ul
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4"
        variants={containerVariants}
        initial={entranceInitial}
        animate="show"
      >
        {visible.map((item) => (
          <motion.li
            key={item.product.id}
            variants={staggerItemVariants}
            layout={!reduced}
          >
            <ProductCard
              product={item.product}
              priceSlot={item.priceSlot}
              overlay={<InCartChip productId={item.product.id} />}
              // Variant products get the quick-pick sheet: choose a size right
              // here instead of a full page trip. The trigger swallows its
              // click (same pattern as QuickAddToCart), so the card link still
              // works everywhere else; the sheet renders in a portal.
              footer={
                item.product.hasVariants ? (
                  <VariantQuickSheet
                    productId={item.product.id}
                    slug={item.product.slug}
                    gateSlot={item.priceSlot}
                    className="mt-2"
                  />
                ) : null
              }
            />
          </motion.li>
        ))}
      </motion.ul>

      {!done ? (
        <div
          ref={sentinelRef}
          className="mt-8 flex flex-col items-center gap-2"
        >
          <button
            type="button"
            onClick={() => {
              hapticTap();
              void handleLoadMore();
            }}
            disabled={pending}
            className="inline-flex min-h-11 w-full max-w-xs items-center justify-center gap-2 rounded-full bg-card px-6 text-sm font-semibold text-foreground shadow-sm ring-1 ring-foreground/10 outline-none transition-[background-color,transform,box-shadow] hover:bg-muted hover:shadow-md focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] disabled:opacity-70"
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Loading…
              </>
            ) : (
              "Load more"
            )}
          </button>
          <p className="font-tabular text-xs text-muted-foreground">
            Showing {visible.length.toLocaleString("en-IN")} so far
          </p>
        </div>
      ) : null}
    </div>
  );
}
