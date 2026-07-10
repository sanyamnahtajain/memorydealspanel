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
 */

import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ImageOff, Loader2 } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "motion/react";

import type { PublicProduct } from "@/server/dto/product";
import { EmptyState } from "@/components/common/EmptyState";
import { staggerItemVariants } from "@/components/motion/primitives";
import {
  GALLERY_HERO_CLASS,
  galleryTransitionName,
} from "@/components/storefront/ProductGallery";

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
        initial={reduced ? "show" : "hidden"}
        animate="show"
      >
        {visible.map((item) => (
          <motion.li
            key={item.product.id}
            variants={staggerItemVariants}
            layout={!reduced}
          >
            <ProductCard item={item} />
          </motion.li>
        ))}
      </motion.ul>

      {!done ? (
        <div
          ref={sentinelRef}
          className="mt-6 flex items-center justify-center"
        >
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-card px-5 text-sm font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-70"
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
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

function primaryImage(product: PublicProduct) {
  if (product.images.length === 0) return null;
  const primary =
    product.images.find((img) => img.isPrimary) ??
    [...product.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return primary ?? null;
}

function specSnippet(product: PublicProduct): string | null {
  const { specs } = product;
  if (specs && typeof specs === "object" && !Array.isArray(specs)) {
    const parts = Object.entries(specs as Record<string, unknown>)
      .filter(([, v]) => typeof v === "string" || typeof v === "number")
      .slice(0, 2)
      .map(([, v]) => String(v));
    if (parts.length > 0) return parts.join(" · ");
  }
  return product.tags.length > 0 ? product.tags.slice(0, 2).join(" · ") : null;
}

function ProductCard({ item }: { item: ProductCardItem }) {
  const { product } = item;
  const image = primaryImage(product);
  const snippet = specSnippet(product);

  return (
    <Link
      href={`/p/${product.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm outline-none transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 hover:shadow-md active:scale-[0.99]"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-muted">
        {image ? (
          <Image
            src={image.thumbUrl ?? image.url}
            alt={product.name}
            fill
            sizes="(min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
            // Shared-element seam: the detail gallery's hero image carries the
            // same `view-transition-name`, so a supporting browser morphs this
            // thumbnail into the hero on navigation. Progressive enhancement —
            // browsers without the View Transitions API just cross-fade.
            className={`${GALLERY_HERO_CLASS} object-cover transition-transform duration-300 ease-out group-hover:scale-105`}
            style={{ viewTransitionName: galleryTransitionName(product.id) }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-7" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.brand ? (
          <span className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
            {product.brand}
          </span>
        ) : null}
        <h3 className="line-clamp-2 text-sm font-semibold text-foreground">
          {product.name}
        </h3>
        {snippet ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">{snippet}</p>
        ) : null}
        <div className="mt-auto pt-2">{item.priceSlot}</div>
      </div>
    </Link>
  );
}
