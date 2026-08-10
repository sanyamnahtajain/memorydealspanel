import { describe, expect, it } from "vitest";
import {
  canonical,
  categoryNameMatchesQuery,
  singularize,
  squash,
  termVariants,
} from "./search-normalize";

describe("squash / singularize / canonical", () => {
  it("squash strips spacing, case and punctuation", () => {
    expect(squash("Power Banks")).toBe("powerbanks");
    expect(squash("  Screen-Protectors! ")).toBe("screenprotectors");
  });

  it("singularize handles common English plurals", () => {
    expect(singularize("banks")).toBe("bank");
    expect(singularize("boxes")).toBe("box");
    expect(singularize("batteries")).toBe("battery");
    expect(singularize("glass")).toBe("glass"); // -ss never truncates
    expect(singularize("bank")).toBe("bank");
  });

  it("canonical unifies every user spelling of the same thing", () => {
    for (const q of ["power bank", "power banks", "powerbanks", "PowerBank", "POWER-BANKS"]) {
      expect(canonical(q)).toBe("powerbank");
    }
  });
});

describe("termVariants", () => {
  it("covers singular + plural spellings of a term", () => {
    expect(termVariants("banks")).toEqual(expect.arrayContaining(["banks", "bank"]));
    expect(termVariants("battery")).toEqual(
      expect.arrayContaining(["battery", "batteries"]),
    );
    expect(termVariants("bank")).toEqual(expect.arrayContaining(["bank", "banks"]));
  });
});

describe("categoryNameMatchesQuery", () => {
  it("matches every spacing/plural form against the category", () => {
    for (const q of ["power bank", "power banks", "powerbanks", "powerbank"]) {
      expect(categoryNameMatchesQuery("Power Banks", q)).toBe(true);
    }
  });

  it("a broader single word still reaches the category; noise does not", () => {
    expect(categoryNameMatchesQuery("Power Banks", "power")).toBe(true);
    expect(categoryNameMatchesQuery("Power Banks", "cable")).toBe(false);
    // Too-short canonical queries never match (noise wall).
    expect(categoryNameMatchesQuery("Power Banks", "po")).toBe(false);
  });

  it("works for other category shapes", () => {
    expect(categoryNameMatchesQuery("Screen Protectors", "screenprotector")).toBe(true);
    expect(categoryNameMatchesQuery("Neckbands", "neck bands")).toBe(true);
    expect(categoryNameMatchesQuery("Car Chargers", "carcharger")).toBe(true);
  });
});
