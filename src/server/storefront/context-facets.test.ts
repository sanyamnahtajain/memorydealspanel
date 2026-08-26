import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { ANON_VIEWER } from "@/server/types/viewer";
import {
  assembleContextFacets,
  brandFacetsForCategory,
  categoryFacetsForBrand,
  discoverProducts,
} from "./discovery";

/**
 * Context-scoped facets (owner: "if i am on boat brand page, why i am seeing
 * filter for zebronics; and if i am under a category, it should show me brands
 * under filter sheet").
 *
 * Pure tests cover the assembly step; the integration tests run against the
 * LOCAL seeded Mongo with a self-contained fixture (created in beforeAll,
 * deleted in afterAll) proving THE CORE RULE:
 *   - a category's brand facet contains ONLY brands with visible products in
 *     that category (inactive brands, draft/soft-deleted products excluded);
 *   - a brand's category facet contains ONLY categories the brand stocks;
 *   - the additive `categoryIds` discovery filter narrows server-side.
 */

const UNIQ = `ctxfacet-${Date.now()}`;

let categoryAId = "";
let categoryBId = "";
let brandInId = "";
let brandOutId = "";
let brandInactiveId = "";
const productIds: string[] = [];

async function createProduct(data: {
  categoryId: string;
  brandId: string | null;
  status?: "ACTIVE" | "INACTIVE";
  deleted?: boolean;
  n: number;
}): Promise<void> {
  const p = await prisma.product.create({
    data: {
      categoryId: data.categoryId,
      brandId: data.brandId,
      name: `${UNIQ} product ${data.n}`,
      slug: `${UNIQ}-product-${data.n}`,
      sku: `${UNIQ}-SKU-${data.n}`,
      price: 12300,
      stockStatus: "IN_STOCK",
      status: data.status ?? "ACTIVE",
      deletedAt: data.deleted ? new Date() : null,
    },
    select: { id: true },
  });
  productIds.push(p.id);
}

beforeAll(async () => {
  const [catA, catB] = await Promise.all([
    prisma.category.create({
      data: { name: `${UNIQ} Cat A`, slug: `${UNIQ}-cat-a`, status: "ACTIVE" },
      select: { id: true },
    }),
    prisma.category.create({
      data: { name: `${UNIQ} Cat B`, slug: `${UNIQ}-cat-b`, status: "ACTIVE" },
      select: { id: true },
    }),
  ]);
  categoryAId = catA.id;
  categoryBId = catB.id;

  const [brandIn, brandOut, brandInactive] = await Promise.all([
    prisma.brand.create({
      data: { name: `${UNIQ} Brand In`, slug: `${UNIQ}-brand-in` },
      select: { id: true },
    }),
    prisma.brand.create({
      data: { name: `${UNIQ} Brand Out`, slug: `${UNIQ}-brand-out` },
      select: { id: true },
    }),
    prisma.brand.create({
      data: {
        name: `${UNIQ} Brand Off`,
        slug: `${UNIQ}-brand-off`,
        status: "INACTIVE",
      },
      select: { id: true },
    }),
  ]);
  brandInId = brandIn.id;
  brandOutId = brandOut.id;
  brandInactiveId = brandInactive.id;

  // Category A: 2 visible Brand-In products, plus noise that must NOT count —
  // an INACTIVE product, a soft-deleted product, an inactive-brand product,
  // and a brandless product (no brand chip for it).
  await createProduct({ categoryId: categoryAId, brandId: brandInId, n: 1 });
  await createProduct({ categoryId: categoryAId, brandId: brandInId, n: 2 });
  await createProduct({
    categoryId: categoryAId,
    brandId: brandInId,
    status: "INACTIVE",
    n: 3,
  });
  await createProduct({
    categoryId: categoryAId,
    brandId: brandInId,
    deleted: true,
    n: 4,
  });
  await createProduct({
    categoryId: categoryAId,
    brandId: brandInactiveId,
    n: 5,
  });
  await createProduct({ categoryId: categoryAId, brandId: null, n: 6 });
  // Category B: 1 visible Brand-Out product — Brand Out must never appear in
  // Category A's facet, and Category B must appear for Brand Out only.
  await createProduct({ categoryId: categoryBId, brandId: brandOutId, n: 7 });
  // Brand In also stocks category B (1 product) — for the brand-page facet.
  await createProduct({ categoryId: categoryBId, brandId: brandInId, n: 8 });
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.brand.deleteMany({
    where: { id: { in: [brandInId, brandOutId, brandInactiveId] } },
  });
  await prisma.category.deleteMany({
    where: { id: { in: [categoryAId, categoryBId] } },
  });
});

describe("assembleContextFacets (pure)", () => {
  const masters = [
    { id: "m1", name: "boAt", slug: "boat" },
    { id: "m2", name: "Ambrane", slug: "ambrane" },
  ];

  it("joins counts with masters and sorts by count desc, then name", () => {
    const out = assembleContextFacets(
      [
        { id: "m1", count: 2 },
        { id: "m2", count: 5 },
      ],
      masters,
    );
    expect(out).toEqual([
      { id: "m2", name: "Ambrane", slug: "ambrane", count: 5 },
      { id: "m1", name: "boAt", slug: "boat", count: 2 },
    ]);
  });

  it("breaks count ties by name", () => {
    const out = assembleContextFacets(
      [
        { id: "m1", count: 3 },
        { id: "m2", count: 3 },
      ],
      masters,
    );
    expect(out.map((o) => o.name)).toEqual(["Ambrane", "boAt"]);
  });

  it("drops null ids, zero counts, and groups without a master row", () => {
    const out = assembleContextFacets(
      [
        { id: null, count: 9 },
        { id: "m1", count: 0 },
        { id: "ghost", count: 4 },
        { id: "m2", count: 1 },
      ],
      masters,
    );
    expect(out).toEqual([
      { id: "m2", name: "Ambrane", slug: "ambrane", count: 1 },
    ]);
  });

  it("returns [] for empty input", () => {
    expect(assembleContextFacets([], masters)).toEqual([]);
  });
});

describe("brandFacetsForCategory (integration)", () => {
  it("returns ONLY brands with visible products in the category, with counts", async () => {
    const facets = await brandFacetsForCategory(categoryAId);
    // Exactly one brand qualifies: Brand In, with the 2 visible products.
    expect(facets).toEqual([
      {
        id: brandInId,
        name: `${UNIQ} Brand In`,
        slug: `${UNIQ}-brand-in`,
        count: 2,
      },
    ]);
    // Never the other-category brand, never the inactive one.
    const ids = facets.map((f) => f.id);
    expect(ids).not.toContain(brandOutId);
    expect(ids).not.toContain(brandInactiveId);
    // And structurally price-free.
    for (const f of facets) {
      expect("price" in f).toBe(false);
      expect("mrp" in f).toBe(false);
    }
  });

  it("returns [] for a category with no branded visible products", async () => {
    const empty = await prisma.category.create({
      data: {
        name: `${UNIQ} Cat Empty`,
        slug: `${UNIQ}-cat-empty`,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    try {
      expect(await brandFacetsForCategory(empty.id)).toEqual([]);
    } finally {
      await prisma.category.delete({ where: { id: empty.id } });
    }
  });
});

describe("categoryFacetsForBrand (integration)", () => {
  it("returns ONLY the categories the brand has visible products in", async () => {
    const facets = await categoryFacetsForBrand(brandInId);
    expect(facets).toEqual([
      {
        id: categoryAId,
        name: `${UNIQ} Cat A`,
        slug: `${UNIQ}-cat-a`,
        count: 2,
      },
      {
        id: categoryBId,
        name: `${UNIQ} Cat B`,
        slug: `${UNIQ}-cat-b`,
        count: 1,
      },
    ]);
  });

  it("a single-category brand yields exactly that category", async () => {
    const facets = await categoryFacetsForBrand(brandOutId);
    expect(facets).toEqual([
      {
        id: categoryBId,
        name: `${UNIQ} Cat B`,
        slug: `${UNIQ}-cat-b`,
        count: 1,
      },
    ]);
  });
});

describe("discoverProducts categoryIds filter (additive)", () => {
  it("narrows a brand-scoped listing to the selected categories, server-side", async () => {
    const all = await discoverProducts(ANON_VIEWER, {
      brandIds: [brandInId],
      limit: 50,
    });
    expect(all.total).toBe(3);

    const onlyB = await discoverProducts(ANON_VIEWER, {
      brandIds: [brandInId],
      categoryIds: [categoryBId],
      limit: 50,
    });
    expect(onlyB.total).toBe(1);
    for (const item of onlyB.items) {
      expect(item.categoryId).toBe(categoryBId);
      expect("price" in item).toBe(false);
    }

    // Multiple categories OR together.
    const both = await discoverProducts(ANON_VIEWER, {
      brandIds: [brandInId],
      categoryIds: [categoryAId, categoryBId],
      limit: 50,
    });
    expect(both.total).toBe(3);
  });

  it("leaves the query unchanged when categoryIds is absent or empty", async () => {
    const absent = await discoverProducts(ANON_VIEWER, {
      brandIds: [brandInId],
      limit: 50,
    });
    const empty = await discoverProducts(ANON_VIEWER, {
      brandIds: [brandInId],
      categoryIds: [],
      limit: 50,
    });
    expect(empty.total).toBe(absent.total);
  });
});
