import { describe, expect, it } from "vitest";

import {
  HALF_LIFE_DAYS,
  buildRecommendIndex,
  orderDampening,
  recencyWeight,
  topRelated,
  topSellers,
} from "./recommend";

const NOW = new Date("2026-08-25T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

function order(placedAt: Date, ...productIds: string[]) {
  return { productIds, placedAt };
}

describe("recommend — the weights themselves", () => {
  it("halves an order's voice every 90 days", () => {
    expect(recencyWeight(daysAgo(0), NOW)).toBeCloseTo(1);
    expect(recencyWeight(daysAgo(HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.5);
    expect(recencyWeight(daysAgo(HALF_LIFE_DAYS * 2), NOW)).toBeCloseTo(0.25);
  });

  it("never lets a future clock inflate a weight past 1", () => {
    expect(recencyWeight(new Date(NOW.getTime() + DAY), NOW)).toBe(1);
  });

  it("dampens a giant restock order instead of letting it swamp the matrix", () => {
    // 3 deliberate lines speak much louder per-pair than a 40-line restock.
    expect(orderDampening(3)).toBeGreaterThan(orderDampening(40) * 2);
    expect(orderDampening(40)).toBeGreaterThan(0); // …but still counts.
  });
});

describe("recommend — what shops order together wins", () => {
  it("recommends the true partner over an unrelated product", () => {
    const index = buildRecommendIndex(
      [
        order(daysAgo(5), "case", "guard"),
        order(daysAgo(9), "case", "guard"),
        order(daysAgo(12), "case", "guard"),
        order(daysAgo(7), "cable", "charger"),
      ],
      NOW,
    );
    expect(topRelated(index, "case", 2)[0]).toBe("guard");
    expect(topRelated(index, "case", 5)).not.toContain("charger");
  });

  it("prefers a recent pairing over an ancient one", () => {
    const index = buildRecommendIndex(
      [
        // "old" paired three times, a year ago. "fresh" once, last week.
        order(daysAgo(365), "hero", "old"),
        order(daysAgo(365), "hero", "old"),
        order(daysAgo(365), "hero", "old"),
        order(daysAgo(6), "hero", "fresh"),
      ],
      NOW,
    );
    // 3 × 0.06 (year-old weight) < 1 × 0.95 — stock cycles, phones die.
    expect(topRelated(index, "hero", 2)[0]).toBe("fresh");
  });

  it("does not let the shop's best-seller top every rail", () => {
    // "star" is in EVERY order, "partner" only pairs with "case". Raw
    // co-occurrence would put star first for case; affinity puts partner.
    const index = buildRecommendIndex(
      [
        order(daysAgo(1), "case", "partner", "star"),
        order(daysAgo(2), "case", "partner", "star"),
        order(daysAgo(3), "cable", "star"),
        order(daysAgo(4), "charger", "star"),
        order(daysAgo(5), "tempered", "star"),
        order(daysAgo(6), "mount", "star"),
      ],
      NOW,
    );
    expect(topRelated(index, "case", 1)[0]).toBe("partner");
  });

  it("collapses duplicate lines of the same product inside one order", () => {
    const index = buildRecommendIndex(
      [order(daysAgo(1), "a", "a", "a", "b")],
      NOW,
    );
    // Popularity counts the order once, not per duplicate line.
    expect(index.popularity.get("a")).toBeCloseTo(
      index.popularity.get("b") ?? 0,
    );
  });
});

describe("recommend — cold starts", () => {
  it("answers empty for an unknown product instead of guessing", () => {
    const index = buildRecommendIndex([order(daysAgo(1), "a", "b")], NOW);
    expect(topRelated(index, "brand-new-product", 4)).toEqual([]);
  });

  it("a single-item order builds popularity but no pairs", () => {
    const index = buildRecommendIndex([order(daysAgo(1), "solo")], NOW);
    expect(topRelated(index, "solo", 4)).toEqual([]);
    expect(topSellers(index, 1)).toEqual(["solo"]);
  });

  it("top sellers rank by recency-weighted volume, for the fallback rail", () => {
    const index = buildRecommendIndex(
      [
        order(daysAgo(300), "was-hot"),
        order(daysAgo(300), "was-hot"),
        order(daysAgo(300), "was-hot"),
        order(daysAgo(2), "is-hot"),
        order(daysAgo(4), "is-hot"),
      ],
      NOW,
    );
    expect(topSellers(index, 1)).toEqual(["is-hot"]);
  });

  it("handles no orders at all", () => {
    const index = buildRecommendIndex([], NOW);
    expect(topRelated(index, "x", 3)).toEqual([]);
    expect(topSellers(index, 3)).toEqual([]);
  });
});
