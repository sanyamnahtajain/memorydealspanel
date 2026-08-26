import { describe, expect, it } from "vitest";

import {
  BASELINE_WINDOW_DAYS,
  MIN_RECENT_ACTIVITY,
  RECENT_WINDOW_DAYS,
  SMOOTHING,
  W_ORDER,
  W_VIEW,
  buildTrendingScores,
  mergePinnedFirst,
  topTrending,
  type TrendingOrderLine,
  type TrendingPageView,
} from "./trending";

const NOW = new Date("2026-08-25T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

function line(
  productId: string,
  quantity: number,
  placedAt: Date,
): TrendingOrderLine {
  return { productId, quantity, placedAt };
}

function view(productId: string, createdAt: Date): TrendingPageView {
  return { productId, createdAt };
}

describe("trending — surge beats steady volume", () => {
  it("ranks a suddenly-moving product above a bigger steady best-seller", () => {
    // "steady" sells 20 units EVERY week, four weeks running — 80 total.
    const steady = [
      line("steady", 20, daysAgo(2)),
      line("steady", 20, daysAgo(10)),
      line("steady", 20, daysAgo(17)),
      line("steady", 20, daysAgo(24)),
    ];
    // "surge" was dead for three weeks, then sold 10 units this week.
    const surge = [line("surge", 10, daysAgo(1))];

    const ids = topTrending([...steady, ...surge], [], NOW, 5);
    expect(ids[0]).toBe("surge");
    expect(ids).toContain("steady"); // still above the floor, just not first
  });

  it("weighs one ordered unit like W_ORDER/W_VIEW views", () => {
    // Same recent weighted units, one from a single 2-unit order, one from
    // views — they tie on score, so ordering falls to the deterministic tie
    // break. The point: 2 units × W_ORDER === 10 views × W_VIEW.
    const orders = [line("buyer", 2, daysAgo(1))];
    const views = Array.from({ length: (2 * W_ORDER) / W_VIEW }, () =>
      view("looker", daysAgo(1)),
    );
    const scores = buildTrendingScores(orders, views, NOW);
    const buyer = scores.find((s) => s.productId === "buyer");
    const looker = scores.find((s) => s.productId === "looker");
    expect(buyer?.score).toBeCloseTo(looker?.score ?? NaN);
  });
});

describe("trending — the noise gate (MIN_RECENT_ACTIVITY)", () => {
  it("never surfaces a product below the recent-activity floor", () => {
    // Two stray views (2 weighted units < floor of 3) on a dead product.
    const views = [view("stray", daysAgo(1)), view("stray", daysAgo(2))];
    expect(topTrending([], views, NOW, 10)).toEqual([]);
  });

  it("surfaces a product exactly AT the floor", () => {
    const views = Array.from({ length: MIN_RECENT_ACTIVITY }, () =>
      view("edge", daysAgo(1)),
    );
    expect(topTrending([], views, NOW, 10)).toEqual(["edge"]);
  });

  it("ignores a product whose activity is all in the baseline window", () => {
    // Sold well two weeks ago, nothing this week: recent = 0 → gated out.
    const lines = [line("faded", 50, daysAgo(10))];
    expect(topTrending(lines, [], NOW, 10)).toEqual([]);
  });
});

describe("trending — smoothing bounds cold starts", () => {
  it("caps a zero-baseline product's score at recent/SMOOTHING", () => {
    const lines = [line("cold", 1, daysAgo(1))]; // 5 weighted units, no history
    const [score] = buildTrendingScores(lines, [], NOW);
    expect(score?.productId).toBe("cold");
    expect(score?.score).toBeCloseTo((1 * W_ORDER) / SMOOTHING);
    expect(Number.isFinite(score?.score)).toBe(true); // never Infinity
  });

  it("a steady seller's score sits near 1 (recent ≈ its own baseline)", () => {
    const lines = [
      line("steady", 10, daysAgo(3)),
      line("steady", 10, daysAgo(10)),
      line("steady", 10, daysAgo(17)),
      line("steady", 10, daysAgo(24)),
    ];
    const [score] = buildTrendingScores(lines, [], NOW);
    // recent = 50; baseline rate = 150/3 = 50 → 50 / (50 + 5) ≈ 0.91.
    expect(score?.score).toBeCloseTo(50 / 55);
  });
});

describe("trending — the clock is injected", () => {
  it("re-buckets the same events when `now` moves", () => {
    const lines = [line("p", 10, daysAgo(1))];
    // Today the sale is "recent"…
    expect(topTrending(lines, [], NOW, 5)).toEqual(["p"]);
    // …three weeks later the very same sale is baseline-only → gated out.
    const later = new Date(NOW.getTime() + 21 * DAY);
    expect(topTrending(lines, [], later, 5)).toEqual([]);
  });

  it("buckets the window edges exactly", () => {
    // Exactly RECENT_WINDOW_DAYS old ⇒ baseline; just inside ⇒ recent.
    const edge = buildTrendingScores(
      [line("edge", 1, daysAgo(RECENT_WINDOW_DAYS))],
      [view("edge", daysAgo(1)), view("edge", daysAgo(1)), view("edge", daysAgo(1))],
      NOW,
    );
    expect(edge[0]?.recent).toBe(3 * W_VIEW);
    expect(edge[0]?.baseline).toBeCloseTo(
      (1 * W_ORDER * RECENT_WINDOW_DAYS) / BASELINE_WINDOW_DAYS,
    );

    // Exactly at the far edge of the baseline window ⇒ ignored entirely.
    const gone = buildTrendingScores(
      [line("gone", 100, daysAgo(RECENT_WINDOW_DAYS + BASELINE_WINDOW_DAYS))],
      [],
      NOW,
    );
    expect(gone).toEqual([]);
  });

  it("counts a future-dated event (clock skew) as recent, never crashing", () => {
    const lines = [line("skew", 1, new Date(NOW.getTime() + DAY))];
    expect(topTrending(lines, [], NOW, 5)).toEqual(["skew"]);
  });
});

describe("trending — deterministic ordering", () => {
  it("breaks score ties by recent activity, then by id", () => {
    // Engineered EQUAL scores (both 1.0) with different recent activity:
    //   big: recent 4u→20, baseline 9u→45/3=15 ⇒ 20/(15+5) = 1
    //   sml: recent 2u→10, baseline 3u→15/3=5  ⇒ 10/(5+5)  = 1
    const lines = [
      line("big", 4, daysAgo(1)),
      line("big", 9, daysAgo(10)),
      line("sml", 2, daysAgo(1)),
      line("sml", 3, daysAgo(10)),
    ];
    const scores = buildTrendingScores(lines, [], NOW);
    expect(scores[0]?.score).toBeCloseTo(scores[1]?.score ?? NaN);
    expect(scores.map((s) => s.productId)).toEqual(["big", "sml"]);

    // Exact ties (identical events) fall back to id order.
    const tied = buildTrendingScores(
      [line("b", 1, daysAgo(1)), line("a", 1, daysAgo(1))],
      [],
      NOW,
    );
    expect(tied.map((s) => s.productId)).toEqual(["a", "b"]);
  });
});

describe("mergePinnedFirst — the admin override", () => {
  it("puts every pin before every algo result", () => {
    expect(mergePinnedFirst(["p1", "p2"], ["a1", "a2"], 10)).toEqual([
      "p1",
      "p2",
      "a1",
      "a2",
    ]);
  });

  it("dedupes a product that is both pinned and algo-ranked", () => {
    expect(mergePinnedFirst(["p1", "x"], ["a1", "x", "a2"], 10)).toEqual([
      "p1",
      "x",
      "a1",
      "a2",
    ]);
  });

  it("caps at k — pins can fill the whole rail", () => {
    expect(mergePinnedFirst(["p1", "p2", "p3"], ["a1"], 2)).toEqual([
      "p1",
      "p2",
    ]);
  });

  it("handles empty pins, empty algo, duplicate pins and k <= 0", () => {
    expect(mergePinnedFirst([], ["a1"], 5)).toEqual(["a1"]);
    expect(mergePinnedFirst(["p1"], [], 5)).toEqual(["p1"]);
    expect(mergePinnedFirst(["p1", "p1"], [], 5)).toEqual(["p1"]);
    expect(mergePinnedFirst(["p1"], ["a1"], 0)).toEqual([]);
  });
});
