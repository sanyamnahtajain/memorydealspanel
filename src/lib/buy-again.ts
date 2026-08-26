/**
 * "Buy again" favourites — the products ONE customer re-orders most.
 *
 * WHY IT EXISTS: in wholesale, repeat purchase is the whole business. A
 * retailer restocks the same fast movers every couple of weeks; making those
 * one tap away from the home page is worth more than any discovery rail.
 *
 * THE MATHS: a sibling of the co-purchase engine in `./recommend` and it
 * reuses that module's {@link recencyWeight} verbatim (half-life ~90 days) —
 * do NOT fork the decay curve. Each order line contributes
 * `recencyWeight(placedAt, now) * quantity` to its product's score, so:
 *
 *  - a product ordered LAST WEEK outranks the same quantity ordered months
 *    ago (stock cycles; dead phone models fall off the rail on their own);
 *  - quantities AGGREGATE across orders — steady re-ordering beats a single
 *    one-off spike of the same total age.
 *
 * CALLER CONTRACT: this function scores exactly the orders it is given.
 * CANCELLED orders must be excluded by the CALLER (the service filters
 * `status != CANCELLED` in the query) — a basket the customer walked back is
 * not evidence of what they restock.
 *
 * Pure and clock-free: `now` is a parameter, so every rule is testable to
 * the day.
 */

import { recencyWeight } from "./recommend";

/** One order line, reduced to what the scorer needs. Variant lines of the
 * same product carry the same `productId` and simply merge. */
export interface FavouriteOrderItem {
  productId: string;
  quantity: number;
}

/** One order of the customer's own history. */
export interface FavouriteOrder {
  items: FavouriteOrderItem[];
  placedAt: Date;
}

export interface CustomerFavourite {
  productId: string;
  /** Recency-weighted quantity — the ranking key. */
  score: number;
  /** Raw total units ordered across all given orders (unweighted). */
  totalQuantity: number;
}

/**
 * Rank one customer's products by recency-weighted total quantity, best
 * first. Lines with a missing product id or a non-positive quantity are
 * ignored. Deterministic: ties break on raw quantity, then product id.
 */
export function buildCustomerFavourites(
  orders: FavouriteOrder[],
  now: Date,
): CustomerFavourite[] {
  const totals = new Map<string, { score: number; totalQuantity: number }>();

  for (const order of orders) {
    const weight = recencyWeight(order.placedAt, now);
    for (const item of order.items) {
      if (!item.productId) continue;
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue;
      const qty = Math.trunc(item.quantity);
      if (qty <= 0) continue;
      let entry = totals.get(item.productId);
      if (!entry) {
        entry = { score: 0, totalQuantity: 0 };
        totals.set(item.productId, entry);
      }
      entry.score += weight * qty;
      entry.totalQuantity += qty;
    }
  }

  return [...totals.entries()]
    .map(([productId, t]) => ({
      productId,
      score: t.score,
      totalQuantity: t.totalQuantity,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.totalQuantity - a.totalQuantity ||
        a.productId.localeCompare(b.productId),
    );
}
