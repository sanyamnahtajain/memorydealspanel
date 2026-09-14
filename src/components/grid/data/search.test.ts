import { describe, expect, it } from "vitest";

import {
  buildRowHaystack,
  cellMatchesTokens,
  rowHaystackFor,
  rowMatchesTokens,
  squashedCellMatchesTokens,
  tokenizeQuery,
} from "./search";

/** A realistic grid row: name, sku, brand, category, price text. */
function row(...cells: string[]) {
  return buildRowHaystack(cells);
}

const powerbank = row(
  "Ambrane Powerbank 20000mAh PP-20",
  "AMB-PP20-BLK",
  "Ambrane",
  "Power Banks",
  "₹1,199",
);

function matches(haystack: ReturnType<typeof row>, query: string): boolean {
  return rowMatchesTokens(haystack, tokenizeQuery(query));
}

describe("grid search — the complaint, verbatim", () => {
  it("finds 'ambrane 20000' even though no cell contains that exact string", () => {
    // THE BUG: the old single-substring filter returned nothing for this,
    // because the name reads "Ambrane Powerbank 20000mAh" — words in a
    // different order with different spacing. Staff searched the way people
    // talk about stock and the grid said the product did not exist.
    expect(matches(powerbank, "ambrane 20000")).toBe(true);
  });

  it("order never matters", () => {
    expect(matches(powerbank, "20000 ambrane")).toBe(true);
    expect(matches(powerbank, "pp20 powerbank ambrane")).toBe(true);
  });

  it("punctuation and spacing differences vanish", () => {
    expect(matches(powerbank, "pp-20")).toBe(true);
    expect(matches(powerbank, "pp20")).toBe(true);
    expect(matches(powerbank, "20000 mah")).toBe(true);
    expect(matches(powerbank, "20000mah")).toBe(true);
  });

  it("matches across cells — brand from one, spec from another", () => {
    const cable = row("Type C to Lightning Cable 1m", "ERD-TC-27", "ERD", "Cables");
    expect(matches(cable, "erd type c")).toBe(true);
    expect(matches(cable, "type-c erd")).toBe(true);
  });

  it("plurals are forgiven in both directions", () => {
    expect(matches(powerbank, "power banks")).toBe(true);
    const charger = row("Wall Charger 25W", "UB-25", "Ubon", "Chargers");
    expect(matches(charger, "chargers 25w")).toBe(true);
  });
});

describe("grid search — precision is kept", () => {
  it("every word must match: a wrong word rejects the row", () => {
    // AND semantics — adding words NARROWS, like every search staff know.
    expect(matches(powerbank, "ambrane 30000")).toBe(false);
    expect(matches(powerbank, "portronics 20000")).toBe(false);
  });

  it("a blank or junk-only query keeps every row", () => {
    expect(matches(powerbank, "")).toBe(true);
    expect(matches(powerbank, "  --  ")).toBe(true);
  });

  it("still matches the SKU exactly like before", () => {
    expect(matches(powerbank, "amb-pp20-blk")).toBe(true);
    expect(matches(powerbank, "ambpp20blk")).toBe(true);
  });

  it("a query cannot leak across cell boundaries in the plain haystack", () => {
    // The PLAIN haystack keeps "\n" separators for the per-cell highlight pass.
    expect(powerbank.plain).toContain("\n");
  });

  it("a single word cannot fuse the end of one cell onto the start of the next", () => {
    // Matching against one squashed blob of the whole row let the grid
    // invent matches: here the SKU ends "…-C" and the very next column
    // starts "27", and "c27" appears nowhere a human would recognise.
    const cable = row("Type C Cable 1m", "ERD-TC-C", "27 Brands", "Cables");
    expect(matches(cable, "c27")).toBe(false);
    // …while each word still comes from whichever cell holds it.
    expect(matches(cable, "erd cable")).toBe(true);
  });
});

describe("grid search — the highlight pass", () => {
  const tokens = tokenizeQuery("ambrane 20000");

  it("lights up every cell holding any of the words", () => {
    expect(cellMatchesTokens("Ambrane", tokens)).toBe(true);
    expect(cellMatchesTokens("Ambrane Powerbank 20000mAh PP-20", tokens)).toBe(true);
  });

  it("leaves unrelated cells alone", () => {
    expect(cellMatchesTokens("₹1,199", tokens)).toBe(false);
    expect(cellMatchesTokens("Power Banks", tokens)).toBe(false);
  });

  it("highlights nothing for an empty query", () => {
    expect(cellMatchesTokens("Ambrane", tokenizeQuery(""))).toBe(false);
  });
});

describe("grid search — the hot path", () => {
  it("squashedCellMatchesTokens is the pre-squashed form of cellMatchesTokens", () => {
    const tokens = tokenizeQuery("pp-20");
    const haystack = row("Ambrane Powerbank 20000mAh PP-20", "AMB-PP20-BLK");
    // Index 0 is the name cell, already squashed at build time.
    expect(squashedCellMatchesTokens(haystack.cells[0]!, tokens)).toBe(
      cellMatchesTokens("Ambrane Powerbank 20000mAh PP-20", tokens),
    );
    expect(squashedCellMatchesTokens("", tokens)).toBe(false);
  });

  it("builds one haystack per cell, index-aligned with the columns", () => {
    const haystack = row("Wall Charger 25W", "UB-25", "Ubon");
    expect(haystack.cells).toEqual(["wallcharger25w", "ub25", "ubon"]);
  });

  it("rowHaystackFor re-reads a row only when the row object changes", () => {
    const columns = {};
    const rowObject = { id: "p1" };
    let reads = 0;
    const read = () => {
      reads += 1;
      return ["Ambrane", "AMB-1"];
    };

    const first = rowHaystackFor(columns, rowObject, read);
    const second = rowHaystackFor(columns, rowObject, read);
    // Same row object: the second call must not touch the cells at all.
    expect(reads).toBe(1);
    expect(second).toBe(first);

    // An edit replaces the row object — that one, and only that one, re-reads.
    const edited = { id: "p1" };
    rowHaystackFor(columns, edited, read);
    expect(reads).toBe(2);

    // A different column set invalidates everything built for the old one.
    rowHaystackFor({}, rowObject, read);
    expect(reads).toBe(3);
  });
});
