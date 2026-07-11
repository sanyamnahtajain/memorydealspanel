import { describe, expect, it } from "vitest";
import { isPaise } from "@/lib/money";
import {
  ANON_VIEWER,
  type CustomerViewer,
} from "@/server/types/viewer";
import { prisma } from "@/server/db";
import {
  brandFacet,
  specFacets,
  stockFacet,
  tagFacet,
  computePriceBands,
} from "@/server/dal/facets";
import { discoverProducts } from "./discovery";

/**
 * Integration tests against the SEEDED local MongoDB proving the price gate for
 * discovery & search (PRD 7.7):
 *   - The price-band FILTER is IGNORED for an anon viewer (not silently applied),
 *     and NO price key appears in the results.
 *   - The non-price facets (brand / spec / stock / tag) work for anon and never
 *     carry a price.
 *   - `computePriceBands` returns null for anon and priced band counts for an
 *     approved viewer.
 */

const APPROVED_VIEWER: CustomerViewer = {
  kind: "customer",
  customerId: "000000000000000000000001",
  priceAccess: true,
  status: "APPROVED",
};

const PENDING_VIEWER: CustomerViewer = {
  kind: "customer",
  customerId: "000000000000000000000002",
  priceAccess: false,
  status: "PENDING",
};

function assertNoPriceKeys(item: Record<string, unknown>): void {
  expect("price" in item).toBe(false);
  expect("mrp" in item).toBe(false);
  expect("marginPct" in item).toBe(false);
}

describe("discoverProducts price gate", () => {
  it("IGNORES the priceBand filter for anon and returns NO price", async () => {
    // Baseline: anon discovery with no price band.
    const baseline = await discoverProducts(ANON_VIEWER, { limit: 100 });
    expect(baseline.items.length).toBeGreaterThan(0);
    expect(baseline.priceApplied).toBe(false);

    // Same query WITH a narrow price band that would exclude most products if
    // it were honoured. For anon it must be a NO-OP.
    const banded = await discoverProducts(ANON_VIEWER, {
      priceBand: "0-100",
      limit: 100,
    });

    // The band was ignored: results & total are identical to the baseline.
    expect(banded.priceApplied).toBe(false);
    expect(banded.total).toBe(baseline.total);
    expect(banded.items.length).toBe(baseline.items.length);

    // And crucially: NO price key on any returned product.
    for (const item of banded.items) {
      assertNoPriceKeys(item as unknown as Record<string, unknown>);
      expect(typeof item.slug).toBe("string");
    }
  });

  it("IGNORES a price sort for anon (falls back to newest, no price key)", async () => {
    const result = await discoverProducts(ANON_VIEWER, {
      sort: "price-asc",
      limit: 20,
    });
    expect(result.priceApplied).toBe(false);
    expect(result.items.length).toBeGreaterThan(0);
    for (const item of result.items) {
      assertNoPriceKeys(item as unknown as Record<string, unknown>);
    }
  });

  it("APPLIES the priceBand filter and price sort for an approved viewer", async () => {
    const all = await discoverProducts(APPROVED_VIEWER, { limit: 100 });
    const banded = await discoverProducts(APPROVED_VIEWER, {
      priceBand: "0-100",
      sort: "price-asc",
      limit: 100,
    });

    expect(banded.priceApplied).toBe(true);
    // The band is a real filter now: total cannot exceed the unfiltered total.
    expect(banded.total).toBeLessThanOrEqual(all.total);

    let prev = -1;
    for (const item of banded.items) {
      expect("price" in item).toBe(true);
      const priced = item as typeof item & { price: number };
      expect(isPaise(priced.price)).toBe(true);
      // Within the <=₹100 band (0..10000 paise, upper-exclusive).
      expect(priced.price).toBeLessThan(100_00);
      // price-asc ordering holds.
      expect(priced.price).toBeGreaterThanOrEqual(prev);
      prev = priced.price;
    }
  });

  it("applies non-price facet filters (stock) for anon with no price", async () => {
    const inStock = await discoverProducts(ANON_VIEWER, {
      stock: ["IN_STOCK"],
      limit: 100,
    });
    expect(inStock.items.length).toBeGreaterThan(0);
    for (const item of inStock.items) {
      expect(item.stockStatus).toBe("IN_STOCK");
      assertNoPriceKeys(item as unknown as Record<string, unknown>);
    }
  });

  it("paginates by cursor without ever leaking a price to anon", async () => {
    const first = await discoverProducts(ANON_VIEWER, { limit: 5 });
    expect(first.items.length).toBe(5);
    expect(first.nextCursor).not.toBeNull();
    for (const item of first.items) assertNoPriceKeys(item as unknown as Record<string, unknown>);

    const second = await discoverProducts(ANON_VIEWER, {
      limit: 5,
      cursor: first.nextCursor!,
    });
    // No overlap between pages.
    const firstIds = new Set(first.items.map((i) => i.id));
    for (const item of second.items) {
      expect(firstIds.has(item.id)).toBe(false);
      assertNoPriceKeys(item as unknown as Record<string, unknown>);
    }
  });
});

describe("facets are price-free for anon", () => {
  it("brandFacet returns counts with names and NO price", async () => {
    const facet = await brandFacet();
    expect(facet.length).toBeGreaterThan(0);
    for (const b of facet) {
      expect(typeof b.brandId).toBe("string");
      expect(typeof b.name).toBe("string");
      expect(b.count).toBeGreaterThan(0);
      expect("price" in b).toBe(false);
      expect("mrp" in b).toBe(false);
    }
    // Counts are sorted descending.
    for (let i = 1; i < facet.length; i++) {
      expect(facet[i - 1]!.count).toBeGreaterThanOrEqual(facet[i]!.count);
    }
  });

  it("stockFacet returns all three buckets, counts, NO price", async () => {
    const facet = await stockFacet();
    const statuses = facet.map((f) => f.status).sort();
    expect(statuses).toEqual(["IN_STOCK", "LOW", "OUT_OF_STOCK"]);
    for (const bucket of facet) {
      expect(bucket.count).toBeGreaterThanOrEqual(0);
      expect("price" in bucket).toBe(false);
    }
  });

  it("tagFacet returns tag counts with NO price", async () => {
    const facet = await tagFacet();
    for (const t of facet) {
      expect(typeof t.tag).toBe("string");
      expect(t.count).toBeGreaterThan(0);
      expect("price" in t).toBe(false);
    }
    // Bounded + descending by count.
    for (let i = 1; i < facet.length; i++) {
      expect(facet[i - 1]!.count).toBeGreaterThanOrEqual(facet[i]!.count);
    }
  });

  it("specFacets derives keys -> value counts with NO price", async () => {
    const facets = await specFacets();
    expect(facets.length).toBeGreaterThan(0);
    for (const spec of facets) {
      expect(typeof spec.key).toBe("string");
      expect(spec.values.length).toBeGreaterThan(0);
      expect("price" in spec).toBe(false);
      for (const v of spec.values) {
        expect(typeof v.value).toBe("string");
        expect(v.count).toBeGreaterThan(0);
        expect("price" in v).toBe(false);
      }
      // Values sorted by count descending, bounded.
      for (let i = 1; i < spec.values.length; i++) {
        expect(spec.values[i - 1]!.count).toBeGreaterThanOrEqual(
          spec.values[i]!.count,
        );
      }
    }
  });
});

describe("computePriceBands gate", () => {
  it("returns null for an anon viewer (UI shows login chip)", async () => {
    const bands = await computePriceBands(ANON_VIEWER);
    expect(bands).toBeNull();
  });

  it("returns null for a pending customer viewer", async () => {
    const bands = await computePriceBands(PENDING_VIEWER);
    expect(bands).toBeNull();
  });

  it("returns preset band counts (in paise) for an approved viewer", async () => {
    const bands = await computePriceBands(APPROVED_VIEWER);
    expect(bands).not.toBeNull();
    expect(bands!.map((b) => b.band)).toEqual([
      "0-100",
      "100-500",
      "500-1000",
      "1000+",
    ]);
    for (const b of bands!) {
      expect(Number.isInteger(b.minPaise)).toBe(true);
      expect(b.count).toBeGreaterThanOrEqual(0);
    }
    // The band counts should sum to the total number of visible products with
    // a price (all seeded products have a price), i.e. the full active count.
    const total = bands!.reduce((sum, b) => sum + b.count, 0);
    const activeCount = await prisma.product.count({
      where: { status: "ACTIVE", deletedAt: null },
    });
    expect(total).toBe(activeCount);
  });
});
