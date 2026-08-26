import { describe, expect, it } from "vitest";

import { buildCustomerFavourites, type FavouriteOrder } from "./buy-again";
import { HALF_LIFE_DAYS } from "./recommend";

const NOW = new Date("2026-08-25T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

function order(
  placedAt: Date,
  ...items: { productId: string; quantity: number }[]
): FavouriteOrder {
  return { items, placedAt };
}

describe("buildCustomerFavourites — ranking", () => {
  it("ranks a recent order above an old one at the same quantity", () => {
    const favourites = buildCustomerFavourites(
      [
        order(daysAgo(HALF_LIFE_DAYS * 3), { productId: "old", quantity: 50 }),
        order(daysAgo(3), { productId: "fresh", quantity: 50 }),
      ],
      NOW,
    );
    expect(favourites.map((f) => f.productId)).toEqual(["fresh", "old"]);
    expect(favourites[0]!.score).toBeGreaterThan(favourites[1]!.score);
  });

  it("aggregates quantities for the same product across orders", () => {
    const favourites = buildCustomerFavourites(
      [
        // "steady" totals 60 units across two same-day orders; "spike" is a
        // single 55-unit order the same day. Aggregation must win.
        order(daysAgo(10), { productId: "steady", quantity: 30 }),
        order(daysAgo(10), { productId: "steady", quantity: 30 }),
        order(daysAgo(10), { productId: "spike", quantity: 55 }),
      ],
      NOW,
    );
    expect(favourites[0]).toMatchObject({
      productId: "steady",
      totalQuantity: 60,
    });
    expect(favourites[1]).toMatchObject({
      productId: "spike",
      totalQuantity: 55,
    });
  });

  it("merges variant lines of the same product within one order", () => {
    const favourites = buildCustomerFavourites(
      [
        order(
          daysAgo(1),
          { productId: "case", quantity: 10 }, // red variant line
          { productId: "case", quantity: 15 }, // black variant line
        ),
      ],
      NOW,
    );
    expect(favourites).toHaveLength(1);
    expect(favourites[0]!.totalQuantity).toBe(25);
  });

  it("lets big recent quantities outrank a small habitual trickle", () => {
    const favourites = buildCustomerFavourites(
      [
        order(daysAgo(2), { productId: "mover", quantity: 100 }),
        order(daysAgo(2), { productId: "trickle", quantity: 3 }),
        order(daysAgo(30), { productId: "trickle", quantity: 3 }),
      ],
      NOW,
    );
    expect(favourites[0]!.productId).toBe("mover");
  });
});

describe("buildCustomerFavourites — decay maths", () => {
  it("halves an order's contribution at one half-life, matching recencyWeight", () => {
    const favourites = buildCustomerFavourites(
      [order(daysAgo(HALF_LIFE_DAYS), { productId: "p", quantity: 10 })],
      NOW,
    );
    expect(favourites[0]!.score).toBeCloseTo(5); // 10 units × weight 0.5
    expect(favourites[0]!.totalQuantity).toBe(10); // raw quantity undecayed
  });
});

describe("buildCustomerFavourites — hygiene and contract", () => {
  it("returns empty for no orders", () => {
    expect(buildCustomerFavourites([], NOW)).toEqual([]);
  });

  it("ignores lines with a missing product id or non-positive quantity", () => {
    const favourites = buildCustomerFavourites(
      [
        order(
          daysAgo(1),
          { productId: "", quantity: 10 },
          { productId: "zero", quantity: 0 },
          { productId: "neg", quantity: -4 },
          { productId: "nan", quantity: Number.NaN },
          { productId: "good", quantity: 5 },
        ),
      ],
      NOW,
    );
    expect(favourites.map((f) => f.productId)).toEqual(["good"]);
  });

  it("scores exactly what it is given — cancelled orders are the CALLER's cut", () => {
    // The lib has no status field at all: pass an order and it counts. The
    // service excludes CANCELLED in its query; this pins that division of
    // labour so nobody adds status logic here.
    const walkedBack = order(daysAgo(1), { productId: "p", quantity: 9 });
    expect(buildCustomerFavourites([walkedBack], NOW)).toHaveLength(1);
    expect(buildCustomerFavourites([], NOW)).toHaveLength(0);
  });

  it("breaks exact ties deterministically (quantity, then product id)", () => {
    const favourites = buildCustomerFavourites(
      [
        order(
          daysAgo(1),
          { productId: "b", quantity: 5 },
          { productId: "a", quantity: 5 },
          { productId: "c", quantity: 7 },
        ),
      ],
      NOW,
    );
    expect(favourites.map((f) => f.productId)).toEqual(["c", "a", "b"]);
  });
});
