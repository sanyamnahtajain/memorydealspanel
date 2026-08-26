import { describe, expect, it } from "vitest";

import {
  MAX_PASTE_LINES,
  matchPasteText,
  normalizeModelText,
  parsePasteText,
} from "./allocation-paste";

/**
 * Paste-a-list parsing + fuzzy matching — the "100 models in one paste" path.
 * The formats tested here are the ones shopkeepers actually type.
 */

describe("normalizeModelText", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(normalizeModelText("  S23-Ultra  (5G) ")).toBe("s23 ultra 5g");
    expect(normalizeModelText("iPhone 15")).toBe("iphone 15");
    expect(normalizeModelText("!!!")).toBe("");
  });
});

describe("parsePasteText", () => {
  it("reads 'name qty' lines in the formats people type", () => {
    const { lines, unreadable } = parsePasteText(
      [
        "S23 Ultra 20",
        "iPhone 15 - 30",
        "redmi note 13: 50",
        "Pixel 8 x20",
        "Realme 11 = 40",
        "Vivo Y28, 10",
        "Moto G54 20 pcs",
      ].join("\n"),
    );
    expect(unreadable).toEqual([]);
    expect(lines).toEqual([
      { name: "S23 Ultra", qty: 20 },
      { name: "iPhone 15", qty: 30 },
      { name: "redmi note 13", qty: 50 },
      { name: "Pixel 8", qty: 20 },
      { name: "Realme 11", qty: 40 },
      { name: "Vivo Y28", qty: 10 },
      { name: "Moto G54", qty: 20 },
    ]);
  });

  it("the LAST number is the quantity — digits inside names survive", () => {
    const { lines } = parsePasteText("iPhone 15 30");
    expect(lines).toEqual([{ name: "iPhone 15", qty: 30 }]);
  });

  it("skips blank lines entirely", () => {
    const { lines, unreadable } = parsePasteText("\n\nS23 Ultra 20\n   \n");
    expect(lines).toHaveLength(1);
    expect(unreadable).toEqual([]);
  });

  it("reports lines without a readable quantity", () => {
    const { lines, unreadable } = parsePasteText(
      "Samsung S23 Ultra\n20\nGalaxy A15 0\nGood one 10",
    );
    expect(lines).toEqual([{ name: "Good one", qty: 10 }]);
    expect(unreadable).toEqual(["Samsung S23 Ultra", "20", "Galaxy A15 0"]);
  });

  it("counts lines beyond the cap as overflow instead of reading them", () => {
    const text = Array.from(
      { length: MAX_PASTE_LINES + 3 },
      (_, i) => `Model ${i} 10`,
    ).join("\n");
    const { lines, overflow } = parsePasteText(text);
    expect(lines).toHaveLength(MAX_PASTE_LINES);
    expect(overflow).toBe(3);
  });
});

describe("matchPasteText", () => {
  const CANDIDATES = [
    { id: "a", name: "Galaxy S23 Ultra" },
    { id: "b", name: "Galaxy S23" },
    { id: "c", name: "iPhone 15" },
    { id: "d", name: "iPhone 15 Pro Max" },
    { id: "e", name: "Redmi Note 13" },
  ];

  it("matches case- and punctuation-insensitively", () => {
    const { rows, addedAsTyped } = matchPasteText("s23-ultra 20", CANDIDATES);
    expect(addedAsTyped).toEqual([]);
    expect(rows).toEqual([{ modelId: "a", name: "Galaxy S23 Ultra", qty: 20 }]);
  });

  it("an exact name beats a longer containing name", () => {
    const { rows } = matchPasteText("iphone 15 30", CANDIDATES);
    expect(rows).toEqual([{ modelId: "c", name: "iPhone 15", qty: 30 }]);
  });

  it("among containing candidates the shortest (closest) wins", () => {
    const { rows } = matchPasteText("s23 10", CANDIDATES);
    expect(rows[0]!.modelId).toBe("b"); // "Galaxy S23", not "… Ultra"
  });

  it("a pasted name LONGER than the stored one still matches", () => {
    const { rows } = matchPasteText("Xiaomi Redmi Note 13 4G 50", CANDIDATES);
    expect(rows).toEqual([{ modelId: "e", name: "Redmi Note 13", qty: 50 }]);
  });

  it("a name matching no model becomes a CUSTOM row, kept as typed", () => {
    const { rows, addedAsTyped } = matchPasteText(
      "Nokia 3310 20\niPhone 15 10",
      CANDIDATES,
    );
    expect(rows).toEqual([
      { modelId: null, custom: true, name: "Nokia 3310", qty: 20 },
      { modelId: "c", name: "iPhone 15", qty: 10 },
    ]);
    // …and the preview is told, so it can note "will be added as typed".
    expect(addedAsTyped).toEqual(["Nokia 3310"]);
  });

  it("repeated mentions of one CUSTOM name merge case-insensitively", () => {
    const { rows, addedAsTyped } = matchPasteText(
      "Nokia 3310 20\nnokia-3310 10",
      CANDIDATES,
    );
    expect(rows).toEqual([
      { modelId: null, custom: true, name: "Nokia 3310", qty: 30 },
    ]);
    expect(addedAsTyped).toEqual(["Nokia 3310"]);
  });

  it("a custom name is capped at the custom-name length limit", () => {
    const longName = `Ultra ${"X".repeat(120)}`;
    const { rows } = matchPasteText(`${longName} 10`, CANDIDATES);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.custom).toBe(true);
    expect(rows[0]!.name.length).toBeLessThanOrEqual(80);
  });

  it("repeated mentions of one model sum their quantities", () => {
    const { rows } = matchPasteText(
      "iPhone 15 10\niphone-15 20",
      CANDIDATES,
    );
    expect(rows).toEqual([{ modelId: "c", name: "iPhone 15", qty: 30 }]);
  });

  it("carries unreadable lines through from parsing", () => {
    const { unreadable } = matchPasteText("just words", CANDIDATES);
    expect(unreadable).toEqual(["just words"]);
  });
});
