import { describe, it, expect } from "vitest";
import { formatPaise, parseRupees } from "@/lib/money";
import type { ColumnDef, GridRow } from "@/components/grid/types";
import { runValidate } from "./cell-props";
import {
  currencyToDisplay,
  paiseToRupeeInput,
} from "./CurrencyCell";
import {
  parsePercentDraft,
  percentBoundsError,
  percentToDisplay,
  PERCENT_MIN,
  PERCENT_MAX,
} from "./PercentCell";
import { parseNumberDraft } from "./NumberCell";
import { toTagArray } from "./MultiTagCell";
import { toBool } from "./ToggleCell";
import { toImageList } from "./ImageCell";
import { computeValue, computedToDisplay } from "./ComputedCell";
import { chipStyle } from "./option-chip";

const row: GridRow = { id: "r1" };
const col = (extra: Partial<ColumnDef>): ColumnDef => ({
  key: "field",
  header: "Field",
  type: "text",
  ...extra,
});

/* -------------------------------------------------------------------------- */
/*  Currency: paise round-trip                                                */
/* -------------------------------------------------------------------------- */

describe("currency paise round-trip", () => {
  const cases = [0, 1, 99, 100, 49950, 129900, 10000000, 50000000];

  it("paise -> rupee input -> parseRupees returns the original paise", () => {
    for (const paise of cases) {
      const input = paiseToRupeeInput(paise);
      expect(parseRupees(input)).toBe(paise);
    }
  });

  it("editor draft seed matches the parseable rupee form", () => {
    expect(paiseToRupeeInput(49950)).toBe("499.50");
    expect(paiseToRupeeInput(49900)).toBe("499");
    expect(paiseToRupeeInput(5)).toBe("0.05");
    expect(paiseToRupeeInput(null)).toBe("");
  });

  it("human rupee inputs parse to the paise the display would show", () => {
    for (const input of ["499.5", "₹499.50", "1,299", "1,00,000"]) {
      const paise = parseRupees(input);
      expect(paise).not.toBeNull();
      // Round-trips back through the display formatter without loss.
      expect(currencyToDisplay(paise)).toBe(formatPaise(paise as number));
    }
  });

  it("renders stored paise as ₹ and blanks for null", () => {
    expect(currencyToDisplay(49950)).toBe("₹499.50");
    expect(currencyToDisplay(null)).toBe("");
    expect(currencyToDisplay("")).toBe("");
  });

  it("rejects unparseable currency drafts (parseRupees -> null)", () => {
    expect(parseRupees("abc")).toBeNull();
    expect(parseRupees("12,34")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  Percent: bounds                                                           */
/* -------------------------------------------------------------------------- */

describe("percent bounds", () => {
  it("accepts values within 0–100", () => {
    for (const v of [0, 0.5, 42, 99.99, 100]) {
      expect(percentBoundsError(v)).toBeNull();
    }
  });

  it("rejects values outside 0–100 with a helpful message", () => {
    expect(percentBoundsError(-1)).toMatch(/between 0 and 100/);
    expect(percentBoundsError(100.01)).toMatch(/between 0 and 100/);
    expect(percentBoundsError(PERCENT_MIN - 5)).not.toBeNull();
    expect(percentBoundsError(PERCENT_MAX + 5)).not.toBeNull();
  });

  it("treats null (empty) as in-bounds", () => {
    expect(percentBoundsError(null)).toBeNull();
  });

  it("parses drafts with and without a trailing %", () => {
    expect(parsePercentDraft("42")).toEqual({ value: 42, ok: true });
    expect(parsePercentDraft("42%")).toEqual({ value: 42, ok: true });
    expect(parsePercentDraft(" 42.5 % ")).toEqual({ value: 42.5, ok: true });
    expect(parsePercentDraft("")).toEqual({ value: null, ok: true });
    expect(parsePercentDraft("abc")).toEqual({ value: null, ok: false });
  });

  it("formats stored percent numbers with trailing %", () => {
    expect(percentToDisplay(42)).toBe("42%");
    expect(percentToDisplay(42.5)).toBe("42.5%");
    expect(percentToDisplay(null)).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/*  Number parsing                                                            */
/* -------------------------------------------------------------------------- */

describe("number draft parsing", () => {
  it("parses valid numbers and empty as null", () => {
    expect(parseNumberDraft("12")).toEqual({ value: 12, ok: true });
    expect(parseNumberDraft("-3.5")).toEqual({ value: -3.5, ok: true });
    expect(parseNumberDraft("")).toEqual({ value: null, ok: true });
  });
  it("flags non-numeric drafts as not ok (draft preserved, not dropped)", () => {
    expect(parseNumberDraft("abc")).toEqual({ value: null, ok: false });
  });
});

/* -------------------------------------------------------------------------- */
/*  validate() surfacing                                                      */
/* -------------------------------------------------------------------------- */

describe("runValidate surfacing", () => {
  it("returns null when no validate is defined", () => {
    expect(runValidate(col({}), "anything", row)).toBeNull();
  });

  it("surfaces the validator's error message", () => {
    const column = col({
      validate: (v) => (String(v).length < 3 ? "Too short" : null),
    });
    expect(runValidate(column, "ab", row)).toBe("Too short");
    expect(runValidate(column, "abc", row)).toBeNull();
  });

  it("passes the row as validation context", () => {
    const column = col({
      key: "qty",
      validate: (v, r) =>
        (v as number) > (r.max as number) ? "Over max" : null,
    });
    const ctx: GridRow = { id: "r", max: 10 };
    expect(runValidate(column, 20, ctx)).toBe("Over max");
    expect(runValidate(column, 5, ctx)).toBeNull();
  });

  it("catches validator exceptions and surfaces them as errors (never drops input)", () => {
    const column = col({
      validate: () => {
        throw new Error("boom");
      },
    });
    expect(runValidate(column, "x", row)).toBe("boom");
  });

  it("validates currency in paise (not rupees)", () => {
    const column = col({
      type: "currency",
      validate: (v) => ((v as number) < 10000 ? "Min ₹100" : null),
    });
    // parseRupees("₹99") = 9900 paise -> below 10000 -> error surfaced
    expect(runValidate(column, parseRupees("₹99"), row)).toBe("Min ₹100");
    expect(runValidate(column, parseRupees("₹100"), row)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  Coercion helpers                                                          */
/* -------------------------------------------------------------------------- */

describe("value coercion helpers", () => {
  it("toTagArray normalizes to string[]", () => {
    expect(toTagArray(["a", "b"])).toEqual(["a", "b"]);
    expect(toTagArray("solo")).toEqual(["solo"]);
    expect(toTagArray(null)).toEqual([]);
    expect(toTagArray("")).toEqual([]);
  });

  it("toBool coerces truthy representations", () => {
    expect(toBool(true)).toBe(true);
    expect(toBool("true")).toBe(true);
    expect(toBool(1)).toBe(true);
    expect(toBool(false)).toBe(false);
    expect(toBool(null)).toBe(false);
    expect(toBool("nope")).toBe(false);
  });

  it("toImageList filters to string sources", () => {
    expect(toImageList(["a.jpg", "b.png"])).toEqual(["a.jpg", "b.png"]);
    expect(toImageList("one.jpg")).toEqual(["one.jpg"]);
    expect(toImageList(null)).toEqual([]);
    expect(toImageList([1, "ok.jpg", null])).toEqual(["ok.jpg"]);
  });
});

/* -------------------------------------------------------------------------- */
/*  Computed cells (e.g. margin %)                                            */
/* -------------------------------------------------------------------------- */

describe("computed cells", () => {
  const marginCol: ColumnDef = col({
    key: "margin",
    type: "computed",
    compute: (r) => {
      const price = r.price as number;
      const cost = r.cost as number;
      if (!price) return 0;
      return Math.round(((price - cost) / price) * 100);
    },
    format: (v) => `${v}%`,
  });

  it("derives a value from the whole row", () => {
    // price 50000 paise (₹500), cost 30000 paise (₹300) -> 40% margin
    const r: GridRow = { id: "p1", price: 50000, cost: 30000 };
    expect(computeValue({ column: marginCol, row: r })).toBe(40);
    expect(computedToDisplay(40, marginCol.format)).toBe("40%");
  });

  it("returns '' when compute is absent or throws", () => {
    expect(computeValue({ column: col({}), row })).toBe("");
    const throwing = col({
      type: "computed",
      compute: () => {
        throw new Error("nope");
      },
    });
    expect(computeValue({ column: throwing, row })).toBe("");
  });

  it("formats numeric results with en-IN grouping by default", () => {
    expect(computedToDisplay(1234567)).toBe("12,34,567");
    expect(computedToDisplay("")).toBe("");
  });
});

/* -------------------------------------------------------------------------- */
/*  Option chip colors                                                        */
/* -------------------------------------------------------------------------- */

describe("option chip color resolution", () => {
  it("maps semantic token names to tinted classes", () => {
    expect(chipStyle("success").className).toContain("bg-success");
    expect(chipStyle("destructive").className).toContain("bg-destructive");
  });

  it("applies raw hex/rgb colors inline", () => {
    const { style } = chipStyle("#ff0000");
    expect(style?.color).toBe("#ff0000");
    expect(style?.backgroundColor).toContain("#ff0000");
  });

  it("falls back to a neutral chip when no color is given", () => {
    expect(chipStyle(undefined).className).toContain("bg-secondary");
    expect(chipStyle(undefined).style).toBeUndefined();
  });
});
