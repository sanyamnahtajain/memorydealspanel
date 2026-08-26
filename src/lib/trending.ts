/**
 * Trending — the MOMENTUM scorer behind the "Trending now" rail.
 *
 * HOW IT DIFFERS from the other two rails (keep the three coherent):
 *  - Best sellers (lib/recommend.ts `topSellers`) is recency-weighted VOLUME:
 *    the products that sell the most, with old sales slowly fading.
 *  - Buy again (lib/buy-again.ts) is PERSONAL volume: what THIS customer
 *    re-orders.
 *  - Trending is SURGE: activity in the last week measured AGAINST the
 *    product's own recent past. A product suddenly moving beats a perennial
 *    steady seller — the steady seller's baseline is high, so its ratio is
 *    ~1; a product waking up from nothing scores far higher.
 *
 * THE SCORE, per product:
 *
 *   recent   = orderQty·W_ORDER + views·W_VIEW   over the last 7 days
 *   baseline = the same over the 21 days before, normalised to a 7-day rate
 *   score    = recent / (baseline + SMOOTHING)
 *
 * EVERY CONSTANT'S WHY:
 *
 *  - RECENT_WINDOW_DAYS = 7. One trade week. Wholesale buying is weekly-
 *    cyclical (shops restock for the weekend), so anything shorter whipsaws
 *    with the day of the week and anything longer stops being "now".
 *
 *  - BASELINE_WINDOW_DAYS = 21. Three trade weeks immediately before the
 *    recent window: enough history to know what "normal" looks like for the
 *    product, short enough that its life from months ago doesn't haunt the
 *    ratio. The baseline sum is divided by 3 (21/7) so both sides of the
 *    ratio are 7-day rates.
 *
 *  - W_ORDER = 5, W_VIEW = 1. A wholesale order is intent; a view is a
 *    glance. Five browsers equal one ordered unit, so a product people are
 *    actually BUYING always out-trends one people merely look at, while a
 *    genuine browsing spike (a reel going around, a new phone launch) can
 *    still surface a product before its first orders land.
 *
 *  - SMOOTHING = 5. Additive smoothing on the denominator. Without it a
 *    product with ZERO baseline and one stray view would score recent/0 = ∞
 *    and top the rail forever. With it, a cold-start product's score is
 *    bounded by recent/SMOOTHING — it must show real recent activity to
 *    climb, and a single stray view on a dead product scores a mere 1/5
 *    (and is dropped by the floor below anyway).
 *
 *  - MIN_RECENT_ACTIVITY = 3 weighted units. The noise gate: under 3 units
 *    this week (three views, or under one ordered unit) is not a trend, it
 *    is somebody clicking around. Below the floor a product never appears,
 *    no matter how flattering its ratio.
 *
 * Pure and clock-free: `now` is a parameter — no Date.now() in this module —
 * so every window edge is testable to the millisecond. The caller owns
 * loading order lines / page views and caching the result.
 */

/** One order line, reduced to what the scorer needs. */
export interface TrendingOrderLine {
  productId: string;
  quantity: number;
  placedAt: Date;
}

/** One product-page view. */
export interface TrendingPageView {
  productId: string;
  createdAt: Date;
}

/** Days of "now" activity being measured. */
export const RECENT_WINDOW_DAYS = 7;
/** Days of prior history the recent window is compared against. */
export const BASELINE_WINDOW_DAYS = 21;
/** Weighted units contributed by ONE ordered unit. */
export const W_ORDER = 5;
/** Weighted units contributed by ONE page view. */
export const W_VIEW = 1;
/** Additive smoothing on the baseline denominator (see header). */
export const SMOOTHING = 5;
/** Minimum weighted recent activity for a product to score at all. */
export const MIN_RECENT_ACTIVITY = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrendingScore {
  productId: string;
  /** recent / (baseline + SMOOTHING) — higher = hotter. */
  score: number;
  /** Weighted activity in the recent window. */
  recent: number;
  /** Weighted activity in the baseline window, normalised to 7 days. */
  baseline: number;
}

interface Tally {
  recent: number;
  baseline: number;
}

/**
 * Score every product with above-floor recent activity, hottest first.
 * Ties break on more recent activity, then on productId for determinism.
 */
export function buildTrendingScores(
  lines: TrendingOrderLine[],
  views: TrendingPageView[],
  now: Date,
): TrendingScore[] {
  const recentStart = now.getTime() - RECENT_WINDOW_DAYS * DAY_MS;
  const baselineStart =
    recentStart - BASELINE_WINDOW_DAYS * DAY_MS;

  const tallies = new Map<string, Tally>();

  const add = (productId: string, at: Date, units: number) => {
    if (!productId || !(units > 0)) return;
    const t = at.getTime();
    // Future-dated events (clock skew) count as "now"; anything older than
    // the baseline window is out of scope entirely.
    const bucket =
      t > recentStart ? "recent" : t > baselineStart ? "baseline" : null;
    if (!bucket) return;
    let tally = tallies.get(productId);
    if (!tally) {
      tally = { recent: 0, baseline: 0 };
      tallies.set(productId, tally);
    }
    tally[bucket] += units;
  };

  for (const line of lines) {
    add(line.productId, line.placedAt, line.quantity * W_ORDER);
  }
  for (const view of views) {
    add(view.productId, view.createdAt, W_VIEW);
  }

  // Normalise the baseline to a 7-day rate so both ratio sides compare
  // like-for-like (21 baseline days = 3 recent-sized windows).
  const baselineToRate = RECENT_WINDOW_DAYS / BASELINE_WINDOW_DAYS;

  const scored: TrendingScore[] = [];
  for (const [productId, tally] of tallies) {
    if (tally.recent < MIN_RECENT_ACTIVITY) continue; // the noise gate
    const baseline = tally.baseline * baselineToRate;
    scored.push({
      productId,
      score: tally.recent / (baseline + SMOOTHING),
      recent: tally.recent,
      baseline,
    });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.recent - a.recent ||
      (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0),
  );
  return scored;
}

/** The top `k` trending product ids, hottest first. */
export function topTrending(
  lines: TrendingOrderLine[],
  views: TrendingPageView[],
  now: Date,
  k: number,
): string[] {
  if (k <= 0) return [];
  return buildTrendingScores(lines, views, now)
    .slice(0, k)
    .map((s) => s.productId);
}

/**
 * The admin-override merge for the rail: pinned products come FIRST, in the
 * order given (the caller sorts newest pin first), then algo results fill the
 * remaining slots. Duplicates never appear — a pinned product is removed from
 * wherever else it would have ranked.
 */
export function mergePinnedFirst(
  pinnedIds: string[],
  algoIds: string[],
  k: number,
): string[] {
  if (k <= 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...pinnedIds, ...algoIds]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= k) break;
  }
  return out;
}
