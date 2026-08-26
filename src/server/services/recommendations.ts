import { prisma } from "@/server/db";
import {
  buildRecommendIndex,
  topRelated,
  topSellers,
  type RecommendIndex,
  type RecommendOrder,
} from "@/lib/recommend";

/**
 * Server side of the co-purchase recommender (the maths lives in
 * src/lib/recommend.ts — read its header for the weighting and why).
 *
 * The index is built from the whole order history in one pass and cached per
 * instance. That is a deliberate scale call, not an oversight: at this shop's
 * volume (hundreds to a few thousand orders) a full scan is a few
 * milliseconds of JSON walking, and a 15-minute cache means it happens a
 * handful of times an hour across all product pages combined. The moment the
 * shop outgrows that, the fix is a precomputed table written by a cron — the
 * pure lib stays identical.
 *
 * CANCELLED orders are excluded: a basket the customer walked back is not
 * evidence of what sells together.
 *
 * Every failure degrades to "no recommendations" — the rail then falls back
 * to category peers exactly as before this feature existed. A broken
 * recommender must never be able to break a product page.
 */

const CACHE_TTL_MS = 15 * 60 * 1000;

const globalForRec = globalThis as unknown as {
  __mdRecIndex: { at: number; index: RecommendIndex } | undefined;
};

/** Items are frozen JSON on the order; pull out just the product ids. */
function orderProductIds(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const ids: string[] = [];
  for (const item of items) {
    const id = (item as { productId?: unknown } | null)?.productId;
    if (typeof id === "string" && id.length > 0) ids.push(id);
  }
  return ids;
}

async function getIndex(): Promise<RecommendIndex | null> {
  const cached = globalForRec.__mdRecIndex;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.index;

  try {
    const rows = await prisma.order.findMany({
      where: { status: { not: "CANCELLED" } },
      select: { items: true, placedAt: true },
    });
    const orders: RecommendOrder[] = rows.map((row) => ({
      productIds: orderProductIds(row.items),
      placedAt: row.placedAt,
    }));
    const index = buildRecommendIndex(orders, new Date());
    globalForRec.__mdRecIndex = { at: Date.now(), index };
    return index;
  } catch (error) {
    console.error("[recommendations] index build failed:", error);
    return null;
  }
}

/**
 * The best co-purchase partners for a product, best first — excluding the
 * product itself. Empty when there is no signal yet (new product, young
 * shop); the caller fills the rail from category peers instead.
 */
export async function coPurchasedProductIds(
  productId: string,
  k: number,
): Promise<string[]> {
  const index = await getIndex();
  if (!index) return [];
  return topRelated(index, productId, k + 1)
    .filter((id) => id !== productId)
    .slice(0, k);
}

/** Recency-weighted best sellers (home-page rails, cold-start fallbacks). */
export async function bestSellerProductIds(k: number): Promise<string[]> {
  const index = await getIndex();
  if (!index) return [];
  return topSellers(index, k);
}
