/**
 * Co-purchase recommender — "shops that ordered this also ordered…".
 *
 * WHAT IT REPLACES: the related rail used to show the first N products of the
 * same category, in catalogue order — no signal at all, the same filler under
 * every product. Real wholesale orders carry the real signal: a retailer who
 * stocks a phone's cases orders its screen guards and chargers in the same
 * breath. That co-occurrence is this module.
 *
 * THE WEIGHTING, and why each part exists:
 *
 *  1. RECENCY DECAY (half-life ~90 days). A pairing from last week says more
 *     about what sells together NOW than one from a year ago — stock cycles,
 *     phone models die. Each order's contribution is halved every 90 days.
 *
 *  2. BIG-ORDER DAMPENING (1/log2(items+1)). A 40-line restock order pairs
 *     everything with everything and would swamp the matrix with noise; a
 *     3-line order is a deliberate combination. Divide by log2 so big orders
 *     still count, just not quadratically.
 *
 *  3. POPULARITY NORMALISATION (divide by sqrt of the partner's own weight).
 *     Without it the shop's best-seller "co-occurs" with everything and tops
 *     every rail — true, and useless. Dividing by √popularity turns raw
 *     co-occurrence into affinity: what sells with THIS product specifically.
 *
 * Pure and clock-free: `now` is a parameter, so every rule is testable to the
 * day. The caller owns loading orders and caching the built index.
 */

/** One order, reduced to what the matrix needs. */
export interface RecommendOrder {
  /** Distinct product ids in the order (duplicates are collapsed). */
  productIds: string[];
  placedAt: Date;
}

export interface RecommendIndex {
  /** productId → (partnerId → affinity score). */
  related: Map<string, Map<string, number>>;
  /** productId → its own recency-weighted popularity. */
  popularity: Map<string, number>;
}

export const HALF_LIFE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Recency weight of one order: 1 today, 0.5 at 90 days, 0.25 at 180… */
export function recencyWeight(placedAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - placedAt.getTime()) / DAY_MS);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/** Dampening for an order with `n` distinct items. */
export function orderDampening(n: number): number {
  return 1 / Math.log2(n + 1);
}

/** Build the co-purchase index over a set of orders. */
export function buildRecommendIndex(
  orders: RecommendOrder[],
  now: Date,
): RecommendIndex {
  const cooc = new Map<string, Map<string, number>>();
  const popularity = new Map<string, number>();

  for (const order of orders) {
    const ids = [...new Set(order.productIds)].filter(Boolean);
    if (ids.length === 0) continue;

    const weight = recencyWeight(order.placedAt, now) * orderDampening(ids.length);

    for (const id of ids) {
      popularity.set(id, (popularity.get(id) ?? 0) + weight);
    }
    // Pairs only exist in orders with 2+ distinct products.
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = 0; j < ids.length; j += 1) {
        if (i === j) continue;
        let partners = cooc.get(ids[i]!);
        if (!partners) {
          partners = new Map();
          cooc.set(ids[i]!, partners);
        }
        partners.set(ids[j]!, (partners.get(ids[j]!) ?? 0) + weight);
      }
    }
  }

  // Normalise by the partner's own popularity (affinity, not fame).
  const related = new Map<string, Map<string, number>>();
  for (const [id, partners] of cooc) {
    const scored = new Map<string, number>();
    for (const [partnerId, raw] of partners) {
      const pop = popularity.get(partnerId) ?? 1;
      scored.set(partnerId, raw / Math.sqrt(Math.max(pop, 1e-9)));
    }
    related.set(id, scored);
  }

  return { related, popularity };
}

/** The top `k` partners for a product, best first. Empty when unknown. */
export function topRelated(
  index: RecommendIndex,
  productId: string,
  k: number,
): string[] {
  const partners = index.related.get(productId);
  if (!partners) return [];
  return [...partners.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);
}

/**
 * Recency-weighted best sellers — the fallback when a product has no
 * co-purchase history yet (new listing, or a shop with few orders).
 */
export function topSellers(index: RecommendIndex, k: number): string[] {
  return [...index.popularity.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);
}
