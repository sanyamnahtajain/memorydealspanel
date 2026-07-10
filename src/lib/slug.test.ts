import { describe, expect, it } from "vitest";
import { makeUniqueSlug, slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Samsung EVO Plus 128GB")).toBe("samsung-evo-plus-128gb");
  });

  it("collapses runs of symbols/whitespace into single hyphens", () => {
    expect(slugify("SanDisk  Ultra --  64GB!!!")).toBe("sandisk-ultra-64gb");
    expect(slugify("USB   Type-C / Lightning")).toBe("usb-type-c-lightning");
  });

  it("strips leading/trailing separators", () => {
    expect(slugify("  -- Hello World --  ")).toBe("hello-world");
  });

  it("strips diacritics to ascii", () => {
    expect(slugify("Café Décor")).toBe("cafe-decor");
    expect(slugify("Über Chargér")).toBe("uber-charger");
  });

  it("converts & to and", () => {
    expect(slugify("Covers & Cases")).toBe("covers-and-cases");
  });

  it("removes apostrophes without splitting words", () => {
    expect(slugify("Boat's Best")).toBe("boats-best");
    expect(slugify("Boat’s Best")).toBe("boats-best");
  });

  it("keeps digits", () => {
    expect(slugify("128GB EVO+ v2.0")).toBe("128gb-evo-v2-0");
  });

  it("returns empty string when nothing usable remains", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!! @@@ ###")).toBe("");
    expect(slugify("日本語")).toBe("");
  });

  it("caps length at 80 chars without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(79)} bcdef`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("is idempotent", () => {
    const once = slugify("Samsung EVO Plus 128GB!");
    expect(slugify(once)).toBe(once);
  });
});

describe("makeUniqueSlug", () => {
  const existsIn = (taken: string[]) => async (slug: string) =>
    taken.includes(slug);

  it("returns the base slug when free", async () => {
    await expect(
      makeUniqueSlug("Samsung EVO", existsIn([])),
    ).resolves.toBe("samsung-evo");
  });

  it("appends -2 on first collision", async () => {
    await expect(
      makeUniqueSlug("Samsung EVO", existsIn(["samsung-evo"])),
    ).resolves.toBe("samsung-evo-2");
  });

  it("increments past consecutive collisions", async () => {
    await expect(
      makeUniqueSlug(
        "Samsung EVO",
        existsIn(["samsung-evo", "samsung-evo-2", "samsung-evo-3"]),
      ),
    ).resolves.toBe("samsung-evo-4");
  });

  it("falls back to 'item' for unslugifiable names", async () => {
    await expect(makeUniqueSlug("!!!", existsIn([]))).resolves.toBe("item");
  });

  it("falls back to a random suffix when the numeric space is exhausted", async () => {
    const taken = new Set([
      "x",
      ...Array.from({ length: 99 }, (_, i) => `x-${i + 2}`),
    ]);
    const slug = await makeUniqueSlug("x", async (s) => taken.has(s));
    expect(slug).toMatch(/^x-[a-z0-9]{6}$/);
    expect(taken.has(slug)).toBe(false);
  });

  it("only calls exists until it finds a free slug", async () => {
    const calls: string[] = [];
    await makeUniqueSlug("abc", async (s) => {
      calls.push(s);
      return s === "abc";
    });
    expect(calls).toEqual(["abc", "abc-2"]);
  });
});
