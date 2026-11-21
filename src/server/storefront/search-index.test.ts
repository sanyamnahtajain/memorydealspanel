import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ prisma: {} }));

import { searchIndexIds, suggestFromIndex, type IndexedProduct, type SearchIndex } from "./search-index";

function product(id: string, name: string, extra: Partial<IndexedProduct> = {}): IndexedProduct {
  const brand = extra.brand ?? null;
  return {
    id,
    name,
    slug: id,
    brand,
    thumbUrl: null,
    categoryId: extra.categoryId ?? "cat-other",
    fields: [name, extra.brand, (extra as { sku?: string }).sku].filter(Boolean).map((v) => String(v).toLowerCase()),
    nameLc: name.toLowerCase(),
    tags: extra.tags ?? [],
    createdAt: extra.createdAt ?? 0,
  };
}

const index: SearchIndex = {
  categories: [
    { id: "cat-pb", name: "Power Banks" },
    { id: "cat-ch", name: "Chargers" },
  ],
  products: [
    product("old-charger", "Ambrane 20W Charger", { categoryId: "cat-ch", brand: "Ambrane", createdAt: 1 }),
    product("new-car", "Zebronics Car Charger 60W", { categoryId: "cat-ch", brand: "Zebronics", createdAt: 5 }),
    product("charger-first", "Charger Fast 33W", { categoryId: "cat-ch", createdAt: 2 }),
    product("ambrane-pb", "Ambrane 20000mAh", { categoryId: "cat-pb", brand: "Ambrane", createdAt: 3 }),
    product("cable", "Type C Cable", { categoryId: "cat-other", tags: ["charging"], createdAt: 4 }),
  ],
};

describe("searchIndexIds", () => {
  it("ranks a name that starts with the query first, then word matches, newest first within a rank", () => {
    expect(searchIndexIds(index, "charger")).toEqual(["charger-first", "new-car", "old-charger"]);
  });

  it("forgives plurals and spacing", () => {
    expect(searchIndexIds(index, "chargers")).toEqual(searchIndexIds(index, "charger"));
    // A product titled without the word is still found through its category.
    expect(searchIndexIds(index, "power banks")).toEqual(["ambrane-pb"]);
    expect(searchIndexIds(index, "powerbank")).toEqual(["ambrane-pb"]);
  });

  it("needs every word to match (AND), on name, brand or tags", () => {
    // The exact product first; other chargers still reach it through the
    // "Chargers" category, as in the database search.
    expect(searchIndexIds(index, "ambrane charger")[0]).toBe("old-charger");
    expect(searchIndexIds(index, "ambrane cable")).toEqual([]);
    expect(searchIndexIds(index, "charging")).toEqual(["cable"]);
    expect(searchIndexIds(index, "zebronics")).toEqual(["new-car"]);
  });

  it("returns nothing for an empty or unmatched query", () => {
    expect(searchIndexIds(index, "   ")).toEqual([]);
    expect(searchIndexIds(index, "projector")).toEqual([]);
  });
});

describe("suggestFromIndex", () => {
  it("returns the top few in the sheet's shape, price-free", () => {
    const rows = suggestFromIndex(index, "charger", 2);
    expect(rows.map((r) => r.id)).toEqual(["charger-first", "new-car"]);
    expect(Object.keys(rows[0]).sort()).toEqual(["brand", "id", "name", "slug", "thumbUrl"]);
  });
});
