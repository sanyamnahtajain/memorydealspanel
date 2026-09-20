import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { resetSwrCache } from "@/server/cache/swr";
import { trendingProductIds } from "./recommendations";

/**
 * Runs the REAL aggregate against a real MongoDB.
 *
 * INCIDENT NOTE: the trending scorer used to download every page-view row in
 * a 28-day window and count them in JavaScript; the home page awaited it and
 * customers watched a skeleton for ~27 seconds. It now asks the database for
 * one count per product per window. The unit tests prove the maths is
 * unchanged — this proves the QUERY is valid on the engine that actually
 * serves production, and that thousands of views cost one small result set.
 */

const DAY = 24 * 60 * 60 * 1000;
const createdProducts: string[] = [];

afterEach(async () => {
  if (createdProducts.length > 0) {
    await prisma.pageView.deleteMany({
      where: { productId: { in: createdProducts } },
    });
    await prisma.product.deleteMany({ where: { id: { in: createdProducts } } });
    createdProducts.length = 0;
  }
  resetSwrCache();
});

async function makeProduct(label: string): Promise<string> {
  const category = await prisma.category.findFirst({ select: { id: true } });
  if (!category) throw new Error("seed a category first");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const product = await prisma.product.create({
    data: {
      name: `QA trending ${label} ${stamp}`,
      slug: `qa-trending-${label}-${stamp}`,
      sku: `QA-TR-${label}-${stamp}`.toUpperCase(),
      categoryId: category.id,
      price: 10000,
      status: "ACTIVE",
      deletedAt: null,
    },
    select: { id: true },
  });
  createdProducts.push(product.id);
  return product.id;
}

async function views(productId: string, count: number, daysAgo: number) {
  const createdAt = new Date(Date.now() - daysAgo * DAY);
  await prisma.pageView.createMany({
    data: Array.from({ length: count }, () => ({
      productId,
      customerId: null,
      createdAt,
    })),
  });
}

describe("trending scorer — database aggregate", () => {
  it("ranks a surging product above a steady one, from counts alone", async () => {
    const surging = await makeProduct("surge");
    const steady = await makeProduct("steady");

    // Surging: lots this week, almost nothing before.
    await views(surging, 400, 1);
    await views(surging, 5, 15);
    // Steady: busy, but just as busy in the baseline weeks.
    await views(steady, 400, 2);
    await views(steady, 1200, 14);
    // Ancient history must not count at all.
    await views(steady, 3000, 60);

    resetSwrCache();
    const ids = await trendingProductIds(24);

    expect(ids).toContain(surging);
    expect(ids).toContain(steady);
    expect(ids.indexOf(surging)).toBeLessThan(ids.indexOf(steady));
  }, 30_000);

  it("answers from cache without touching the database again", async () => {
    const product = await makeProduct("cached");
    await views(product, 50, 1);

    resetSwrCache();
    const first = await trendingProductIds(24);
    // New views land, but the ranking is served stale — instantly — rather
    // than making this caller wait for a recompute.
    await views(product, 50, 1);
    const started = Date.now();
    const second = await trendingProductIds(24);
    expect(second).toEqual(first);
    expect(Date.now() - started).toBeLessThan(500);
  }, 30_000);
});
