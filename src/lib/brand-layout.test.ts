import { describe, expect, it } from "vitest";

import { applyBrandLayout, brandPageInputSchema, parseBrandLayout, type RailCategory } from "./brand-layout";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddd";

const cats: RailCategory[] = [
  { id: A, name: "Chargers", slug: "chargers", image: "/a.png", count: 4 },
  { id: B, name: "Cables", slug: "cables", image: null, count: 9 },
  { id: C, name: "Audio", slug: "audio", image: "/c.png", count: 2 },
];

describe("brand layout", () => {
  it("orders, renames, re-photographs and hides per the owner, then appends the unconfigured", () => {
    const layout = parseBrandLayout([
      { categoryId: C, label: "Earbuds & neckbands", image: "https://cdn.example/boat-audio.webp" },
      { categoryId: B, hidden: true },
      { categoryId: D }, // configured but no products now — skipped
    ]);
    const rail = applyBrandLayout(cats, layout);
    expect(rail.map((c) => [c.id, c.name, c.image])).toEqual([
      [C, "Earbuds & neckbands", "https://cdn.example/boat-audio.webp"],
      [A, "Chargers", "/a.png"],
    ]);
  });

  it("falls back to the catalogue order with no configuration", () => {
    expect(applyBrandLayout(cats, parseBrandLayout(null)).map((c) => c.id)).toEqual([A, B, C]);
  });

  it("drops bad rows one by one, keeps the first of a duplicate, blanks empty labels", () => {
    const layout = parseBrandLayout([
      { categoryId: "nope" },
      { categoryId: A, image: "javascript:alert(1)" }, // unsafe photo → row dropped
      { categoryId: B, label: "  Data cables " },
      { categoryId: C, label: "" },
      { categoryId: B, label: "Dupe" }, // second B ignored
    ]);
    expect(layout).toEqual([
      { categoryId: B, image: null, label: "Data cables", hidden: false },
      { categoryId: C, image: null, label: null, hidden: false },
    ]);
  });

  it("validates the editor's save payload", () => {
    expect(brandPageInputSchema.safeParse({ brandId: A, layout: [], tagline: "x".repeat(121) }).success).toBe(false);
    expect(brandPageInputSchema.safeParse({ brandId: A, layout: [{ categoryId: B }], coverImage: "/brands/cover.webp" }).success).toBe(true);
  });
});
