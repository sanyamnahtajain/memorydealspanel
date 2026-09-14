import { describe, expect, it } from "vitest";

import { lineMatchesGroup, resolveGroupForLine } from "./engine";
import { matcherSelection, type BillingGroupConfig } from "./types";

const group = (
  over: Partial<BillingGroupConfig> & { matcher: BillingGroupConfig["matcher"] },
): BillingGroupConfig => ({
  id: "g1",
  name: "Dealer",
  code: "DLR",
  color: "blue",
  active: true,
  sortOrder: 0,
  rules: [],
  separateBill: true,
  couponStacking: true,
  notes: null,
  ...over,
});

const line = (brandId: string | null, categoryId: string | null) => ({
  key: "k",
  brandId,
  categoryId,
  lineTotalPaise: 10_000,
});

describe("legacy brand-only groups keep working", () => {
  const legacy = group({ matcher: { kind: "brands", brandIds: ["b1"] } });

  it("still matches on brand", () => {
    expect(lineMatchesGroup(line("b1", "c1"), legacy)).toBe(true);
    expect(lineMatchesGroup(line("b2", "c1"), legacy)).toBe(false);
  });

  it("reads as a catalog matcher with no categories", () => {
    expect(matcherSelection(legacy.matcher)).toEqual({
      brandIds: ["b1"],
      categoryIds: [],
    });
  });

  it("never matches on category, since it selects none", () => {
    expect(lineMatchesGroup(line(null, "c1"), legacy)).toBe(false);
  });
});

describe("category matching", () => {
  const byCategory = group({
    matcher: { kind: "catalog", brandIds: [], categoryIds: ["c1"] },
  });

  it("matches a line in the chosen category, whatever its brand", () => {
    expect(lineMatchesGroup(line("b9", "c1"), byCategory)).toBe(true);
    expect(lineMatchesGroup(line(null, "c1"), byCategory)).toBe(true);
  });

  it("doesn't match another category", () => {
    expect(lineMatchesGroup(line("b9", "c2"), byCategory)).toBe(false);
  });

  it("doesn't match a line with no category at all", () => {
    expect(lineMatchesGroup(line("b9", null), byCategory)).toBe(false);
    // A caller that hasn't been taught to send categoryId must not crash or
    // accidentally match — it simply can't match a category rule.
    expect(
      lineMatchesGroup(
        { key: "k", brandId: "b9", lineTotalPaise: 1 },
        byCategory,
      ),
    ).toBe(false);
  });
});

describe("brands and categories together match on EITHER", () => {
  const both = group({
    matcher: { kind: "catalog", brandIds: ["b1"], categoryIds: ["c1"] },
  });

  it("takes a line matching only the brand", () => {
    expect(lineMatchesGroup(line("b1", "c9"), both)).toBe(true);
  });

  it("takes a line matching only the category", () => {
    expect(lineMatchesGroup(line("b9", "c1"), both)).toBe(true);
  });

  it("takes a line matching both", () => {
    expect(lineMatchesGroup(line("b1", "c1"), both)).toBe(true);
  });

  it("rejects a line matching neither", () => {
    // The union, not the intersection — an intersection would bucket almost
    // nothing and look silently broken.
    expect(lineMatchesGroup(line("b9", "c9"), both)).toBe(false);
  });
});

describe("overlap between groups stays deterministic", () => {
  it("the first group by sortOrder wins, across dimensions", () => {
    const byBrand = group({
      id: "brandFirst",
      code: "BF",
      sortOrder: 0,
      matcher: { kind: "catalog", brandIds: ["b1"], categoryIds: [] },
    });
    const byCategory = group({
      id: "catSecond",
      code: "CS",
      sortOrder: 1,
      matcher: { kind: "catalog", brandIds: [], categoryIds: ["c1"] },
    });
    // A line that matches BOTH groups resolves to the one sorted first.
    const resolved = resolveGroupForLine(line("b1", "c1"), [byCategory, byBrand]);
    expect(resolved?.id).toBe("brandFirst");
  });
});
