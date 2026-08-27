import { prisma } from "@/server/db";
import {
  buildRecommendIndex,
  topRelated,
  topSellers,
  type RecommendIndex,
  type RecommendOrder,
} from "@/lib/recommend";
import {
  buildCustomerFavourites,
  type FavouriteOrder,
  type FavouriteOrderItem,
} from "@/lib/buy-again";
import {
  BASELINE_WINDOW_DAYS,
  RECENT_WINDOW_DAYS,
  mergePinnedFirst,
  topTrending,
  type TrendingOrderLine,
} from "@/lib/trending";

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

/** How far back the co-purchase index reads. See the query for why 365. */
const COPURCHASE_WINDOW_DAYS = 365;

const globalForRec = globalThis as unknown as {
  __mdRecIndex: { at: number; index: RecommendIndex } | undefined;
  __mdTrendingAlgo: { at: number; ids: string[] } | undefined;
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
      where: {
        status: { not: "CANCELLED" },
        // Windowed like the trending scorer: an unbounded scan of the whole
        // order history grows forever on a shared-CPU tier. A year covers
        // several full restock cycles, and the 90-day recency half-life has
        // already reduced anything older to ~6% of its weight — so the
        // rankings this produces are the same ones the full scan produced.
        placedAt: { gte: new Date(Date.now() - COPURCHASE_WINDOW_DAYS * DAY_MS) },
      },
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

/* ------------------------------------------------------------------ */
/* Trending — momentum scorer + admin pin override                     */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How many ALGO ids to rank and cache. Deliberately larger than any rail will
 * ask for, so pin-dedup and hidden/deleted-product drop-out (the DAL filters
 * ids it can't show) still leave a full rail.
 */
const TRENDING_ALGO_POOL = 24;

/**
 * The cached ALGO half of the trending rail (see src/lib/trending.ts for the
 * surge maths and every constant's why). Same per-instance 15-minute cache
 * call as the co-purchase index — both windows together are a 28-day slice of
 * orders plus page views (the (productId, createdAt) index covers the view
 * scan), a few milliseconds at this shop's volume.
 *
 * Fails open to `[]`: a broken scorer must never break the home page.
 */
async function trendingAlgoIds(): Promise<string[]> {
  const cached = globalForRec.__mdTrendingAlgo;
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.ids;

  try {
    const now = new Date();
    const since = new Date(
      now.getTime() - (RECENT_WINDOW_DAYS + BASELINE_WINDOW_DAYS) * DAY_MS,
    );
    const [orderRows, viewRows] = await Promise.all([
      prisma.order.findMany({
        where: { status: { not: "CANCELLED" }, placedAt: { gte: since } },
        select: { items: true, placedAt: true },
      }),
      prisma.pageView.findMany({
        where: { createdAt: { gte: since } },
        select: { productId: true, createdAt: true },
      }),
    ]);

    const lines: TrendingOrderLine[] = [];
    for (const row of orderRows) {
      for (const item of orderFavouriteItems(row.items)) {
        lines.push({
          productId: item.productId,
          quantity: item.quantity,
          placedAt: row.placedAt,
        });
      }
    }

    const ids = topTrending(lines, viewRows, now, TRENDING_ALGO_POOL);
    globalForRec.__mdTrendingAlgo = { at: Date.now(), ids };
    return ids;
  } catch (error) {
    console.error("[recommendations] trending scoring failed:", error);
    return [];
  }
}

/**
 * The "Trending now" rail's product ids, best first:
 *
 *   1. ADMIN PINS FIRST — products with `trendingPinnedAt` set (newest pin
 *      first), read FRESH on every call (never cached) so an admin's pin
 *      shows up immediately, filtered to visible rows (ACTIVE, not deleted).
 *   2. Algo (surge) results fill the remaining slots, deduped against pins.
 *
 * Degrades gracefully: algo failure → pins only; pins failure → algo only;
 * both → []. Nothing here ever throws to the page.
 */
export async function trendingProductIds(k: number): Promise<string[]> {
  if (k <= 0) return [];

  let pinnedIds: string[] = [];
  try {
    const pinned = await prisma.product.findMany({
      where: { trendingPinnedAt: { not: null }, status: "ACTIVE", deletedAt: null },
      select: { id: true },
      orderBy: { trendingPinnedAt: "desc" },
    });
    pinnedIds = pinned.map((row) => row.id);
  } catch (error) {
    console.error("[recommendations] trending pins read failed:", error);
  }

  const algoIds = await trendingAlgoIds();
  return mergePinnedFirst(pinnedIds, algoIds, k);
}

/** Items are frozen JSON on the order; pull out {productId, quantity} lines. */
function orderFavouriteItems(items: unknown): FavouriteOrderItem[] {
  if (!Array.isArray(items)) return [];
  const lines: FavouriteOrderItem[] = [];
  for (const item of items) {
    const row = item as { productId?: unknown; quantity?: unknown } | null;
    const id = row?.productId;
    const qty = row?.quantity;
    if (typeof id === "string" && id.length > 0 && typeof qty === "number") {
      lines.push({ productId: id, quantity: qty });
    }
  }
  return lines;
}

/**
 * "Buy again" — the products THIS customer re-orders most, best first
 * (recency-weighted quantities; maths in src/lib/buy-again.ts).
 *
 * Deliberately NOT cached, unlike the co-purchase index above: this is
 * per-customer and cheap — one `findMany` filtered by `customerId` over a few
 * dozen of that customer's own orders — and a stale rail right after placing
 * an order would look broken to the person it is personalised for.
 *
 * CANCELLED orders are excluded here (the lib's caller contract): a basket
 * the customer walked back is not something they want to buy again.
 *
 * Every failure degrades to `[]` — the home page then simply shows no rail.
 */
export async function customerBuyAgainIds(
  customerId: string,
  k: number,
): Promise<string[]> {
  if (k <= 0) return [];
  try {
    const rows = await prisma.order.findMany({
      where: { customerId, status: { not: "CANCELLED" } },
      select: { items: true, placedAt: true },
    });
    const orders: FavouriteOrder[] = rows.map((row) => ({
      items: orderFavouriteItems(row.items),
      placedAt: row.placedAt,
    }));
    return buildCustomerFavourites(orders, new Date())
      .slice(0, k)
      .map((f) => f.productId);
  } catch (error) {
    console.error("[recommendations] buy-again failed:", error);
    return [];
  }
}
