import type * as React from "react";

import type { PublicProduct } from "@/server/dto/product";
import type { ViewMode } from "@/components/preferences/PreferencesProvider";

/**
 * The unit every listing renderer consumes. `product` is always the
 * viewer-projected {@link PublicProduct} — it carries NO money field, ever.
 * `priceSlot` is the server-rendered price UI for this product AND this
 * viewer (produced by `renderPriceSlot`): the real price for an approved
 * customer, or the locked PriceGate chip for anon / pending / expired.
 *
 * Because the amount lives inside an already-rendered React node built on
 * the server, no price value crosses into these client components — the same
 * `ListingItem` drives the grid, the compact rows AND the table cell.
 */
export interface ListingItem {
  product: PublicProduct;
  /** Server-rendered price gate node (real price OR locked chip). */
  priceSlot: React.ReactNode;
  /**
   * Opaque ordering key for price sort, in integer paise — present ONLY for
   * price-authorised (approved) viewers, and ONLY used to order rows on the
   * client. For a gated viewer this is `undefined` and price sort is never
   * offered, so no amount is ever attached to a gated item. A viewer who can
   * sort by this number can already see every price, so exposing the ordering
   * key does not widen the gate.
   */
  priceSortKey?: number;
}

/**
 * Loads the next page of already-gated items. Returns fewer than `pageSize`
 * (or an empty array) when the list is exhausted. Implemented as a server
 * action so price slots stay server-side.
 */
export type LoadMoreFn = (nextPage: number) => Promise<ListingItem[]>;

/** Sort keys offered in the listing. `price-asc` is gated (approved only). */
export type SortKey = "newest" | "name" | "price-asc" | "price-desc";

/** The stock facet. `all` disables the filter. */
export type StockFilter = "all" | "IN_STOCK" | "LOW" | "OUT_OF_STOCK";

export const SORT_KEYS: readonly SortKey[] = [
  "newest",
  "name",
  "price-asc",
  "price-desc",
] as const;

export const STOCK_FILTERS: readonly StockFilter[] = [
  "all",
  "IN_STOCK",
  "LOW",
  "OUT_OF_STOCK",
] as const;

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === "string" && (SORT_KEYS as readonly string[]).includes(value);
}

export function isStockFilter(value: unknown): value is StockFilter {
  return (
    typeof value === "string" && (STOCK_FILTERS as readonly string[]).includes(value)
  );
}

export const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest first",
  name: "Name (A–Z)",
  "price-asc": "Price (low to high)",
  "price-desc": "Price (high to low)",
};

export const STOCK_LABELS: Record<StockFilter, string> = {
  all: "All stock",
  IN_STOCK: "In stock",
  LOW: "Low stock",
  OUT_OF_STOCK: "Out of stock",
};

export const VIEW_MODES: readonly ViewMode[] = ["grid", "compact", "table"] as const;
