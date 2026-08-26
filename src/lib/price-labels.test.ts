import { describe, expect, it } from "vitest";

import { MAX_PRICE_LABEL_IDS, parsePriceLabelIds } from "./price-labels";

const ID_A = "0123456789abcdef01234567";
const ID_B = "89abcdef0123456789abcdef";

describe("parsePriceLabelIds", () => {
  it("parses a comma list of object ids", () => {
    expect(parsePriceLabelIds(`${ID_A},${ID_B}`)).toEqual([ID_A, ID_B]);
  });

  it("drops malformed ids instead of erroring", () => {
    expect(
      parsePriceLabelIds(`${ID_A},not-an-id,';drop--,${ID_B},`),
    ).toEqual([ID_A, ID_B]);
  });

  it("dedupes and normalises case", () => {
    expect(parsePriceLabelIds(`${ID_A},${ID_A.toUpperCase()}`)).toEqual([ID_A]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 100 }, (_, i) =>
      i.toString(16).padStart(24, "0"),
    ).join(",");
    expect(parsePriceLabelIds(many)).toHaveLength(MAX_PRICE_LABEL_IDS);
  });

  it("handles null and empty", () => {
    expect(parsePriceLabelIds(null)).toEqual([]);
    expect(parsePriceLabelIds("")).toEqual([]);
  });
});
