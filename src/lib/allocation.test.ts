import { describe, expect, it } from "vitest";

import {
  parseAllocation,
  perModelIssueText,
  perModelRules,
  toPublicAllocation,
  validatePerModelQuantities,
} from "./allocation";
import { addToCartSchema } from "./schemas/cart";

/**
 * Allocation config + per-model quantity rules.
 *
 * The load-bearing invariants:
 *   - LEGACY configs (no `minPerModel` knob) parse and behave exactly as
 *     before — the knob is additive and a corrupt value degrades to null
 *     instead of switching a required breakdown off.
 *   - Per-model quantities must land on the product's pack multiple ("I can't
 *     order S23 Ultra 11 pcs") and meet the config's per-model minimum.
 *   - The sum-equals-line-quantity contract is untouched.
 */

const MODEL_A = "64b000000000000000000001";
const MODEL_B = "64b000000000000000000002";

const LEGACY_CONFIG = {
  kind: "DEVICE_MODEL",
  required: true,
  modelIds: [MODEL_A, MODEL_B],
};

describe("parseAllocation — backward compatibility", () => {
  it("parses a legacy config unchanged, with no minPerModel", () => {
    const parsed = parseAllocation(LEGACY_CONFIG);
    expect(parsed).not.toBeNull();
    expect(parsed!.required).toBe(true);
    expect(parsed!.modelIds).toEqual([MODEL_A, MODEL_B]);
    expect(parsed!.minPerModel ?? null).toBeNull();
  });

  it("accepts an explicit minPerModel", () => {
    const parsed = parseAllocation({ ...LEGACY_CONFIG, minPerModel: 10 });
    expect(parsed!.minPerModel).toBe(10);
  });

  it("a corrupt minPerModel degrades to null — it must NEVER kill the config", () => {
    for (const junk of ["ten", -5, 0, 1.5, {}, [], NaN]) {
      const parsed = parseAllocation({ ...LEGACY_CONFIG, minPerModel: junk });
      expect(parsed).not.toBeNull();
      expect(parsed!.minPerModel).toBeNull();
      expect(parsed!.required).toBe(true);
    }
  });

  it("null and undefined minPerModel both read as 'no minimum'", () => {
    expect(
      parseAllocation({ ...LEGACY_CONFIG, minPerModel: null })!.minPerModel,
    ).toBeNull();
    expect(parseAllocation(LEGACY_CONFIG)!.minPerModel).toBeUndefined();
  });
});

describe("toPublicAllocation", () => {
  it("carries minPerModel to the storefront projection", () => {
    const pub = toPublicAllocation(
      parseAllocation({ ...LEGACY_CONFIG, minPerModel: 20 }),
    );
    expect(pub).toEqual({
      kind: "DEVICE_MODEL",
      required: true,
      restricted: true,
      minPerModel: 20,
    });
  });

  it("legacy config projects minPerModel: null and still drops required:false", () => {
    expect(toPublicAllocation(parseAllocation(LEGACY_CONFIG))!.minPerModel).toBeNull();
    expect(
      toPublicAllocation(parseAllocation({ ...LEGACY_CONFIG, required: false })),
    ).toBeNull();
  });
});

describe("perModelRules", () => {
  it("no knob, no pack ⇒ the legacy free-for-all (pack 1, min 1)", () => {
    expect(perModelRules(null, null)).toEqual({ pack: 1, min: 1 });
    expect(perModelRules(undefined, undefined)).toEqual({ pack: 1, min: 1 });
  });

  it("pack alone implies one pack minimum", () => {
    expect(perModelRules(null, 10)).toEqual({ pack: 10, min: 10 });
  });

  it("the config minimum aligns UP onto the pack", () => {
    expect(perModelRules(15, 10)).toEqual({ pack: 10, min: 20 });
    expect(perModelRules(20, 10)).toEqual({ pack: 10, min: 20 });
    expect(perModelRules(25, null)).toEqual({ pack: 1, min: 25 });
  });

  it("junk knob values are ignored", () => {
    for (const junk of [0, -3, 1.5, NaN, Infinity]) {
      expect(perModelRules(junk, 10)).toEqual({ pack: 10, min: 10 });
    }
  });
});

describe("perModelIssueText — the inline row message", () => {
  const pack10 = perModelRules(null, 10);

  it("11 pcs at packs of 10 is rejected", () => {
    expect(perModelIssueText(11, pack10)).toBe("Order in packs of 10");
  });

  it("20 pcs at packs of 10 is accepted", () => {
    expect(perModelIssueText(20, pack10)).toBeNull();
    expect(perModelIssueText(10, pack10)).toBeNull();
  });

  it("below the per-model minimum reads 'order at least N pcs'", () => {
    const rules = perModelRules(20, 10);
    expect(perModelIssueText(10, rules)).toBe("Order at least 20 pcs");
    expect(perModelIssueText(20, rules)).toBeNull();
  });

  it("legacy products (no pack, no knob) accept any positive quantity", () => {
    const legacy = perModelRules(null, null);
    for (const qty of [1, 3, 11, 999]) {
      expect(perModelIssueText(qty, legacy)).toBeNull();
    }
  });

  it("zero / negative / fractional quantities ask for a quantity", () => {
    for (const qty of [0, -5, 1.5, NaN]) {
      expect(perModelIssueText(qty, pack10)).toBe("Enter a quantity");
    }
  });
});

describe("validatePerModelQuantities", () => {
  const pack10 = perModelRules(null, 10);

  it("names the offending model in simple English", () => {
    const issues = validatePerModelQuantities(
      [
        { modelId: MODEL_A, qty: 11, name: "S23 Ultra" },
        { modelId: MODEL_B, qty: 20, name: "iPhone 15" },
      ],
      pack10,
    );
    expect(issues).toEqual([
      { modelId: MODEL_A, message: "S23 Ultra: order in packs of 10" },
    ]);
  });

  it("falls back to a generic label when the name is unknown", () => {
    const issues = validatePerModelQuantities([{ modelId: MODEL_A, qty: 7 }], pack10);
    expect(issues[0]!.message).toBe("This model: order in packs of 10");
  });

  it("reports every offending model, none of the valid ones", () => {
    const issues = validatePerModelQuantities(
      [
        { modelId: MODEL_A, qty: 5, name: "A" },
        { modelId: MODEL_B, qty: 30, name: "B" },
        { modelId: "64b000000000000000000003", qty: 41, name: "C" },
      ],
      pack10,
    );
    expect(issues.map((i) => i.modelId)).toEqual([
      MODEL_A,
      "64b000000000000000000003",
    ]);
  });

  it("an empty breakdown has no per-model issues", () => {
    expect(validatePerModelQuantities([], pack10)).toEqual([]);
  });

  it("legacy rules (pack 1, min 1) never flag a positive quantity", () => {
    const issues = validatePerModelQuantities(
      [
        { modelId: MODEL_A, qty: 1 },
        { modelId: MODEL_B, qty: 11 },
      ],
      perModelRules(null, null),
    );
    expect(issues).toEqual([]);
  });

  it("CUSTOM (typed) lines obey exactly the same pack/minimum rules", () => {
    const issues = validatePerModelQuantities(
      [
        { qty: 11, name: "Nokia 3310" }, // custom: no modelId
        { modelId: MODEL_A, qty: 20, name: "S23 Ultra" },
        { qty: 30, name: "Custom OK" },
      ],
      pack10,
    );
    expect(issues).toEqual([
      // The typed name doubles as the issue key for id-less lines.
      { modelId: "Nokia 3310", message: "Nokia 3310: order in packs of 10" },
    ]);
  });
});

describe("the sum-equals-line-quantity contract is untouched", () => {
  const PRODUCT = "64b0000000000000000000aa";

  it("a split summing to the quantity still parses", () => {
    const parsed = addToCartSchema.safeParse({
      productId: PRODUCT,
      quantity: 30,
      breakdown: [
        { modelId: MODEL_A, qty: 10 },
        { modelId: MODEL_B, qty: 20 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("a split NOT summing to the quantity is still rejected", () => {
    const parsed = addToCartSchema.safeParse({
      productId: PRODUCT,
      quantity: 40,
      breakdown: [
        { modelId: MODEL_A, qty: 10 },
        { modelId: MODEL_B, qty: 20 },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("custom (typed) breakdown lines — schema", () => {
  const PRODUCT = "64b0000000000000000000aa";

  it("accepts a mix of master and custom lines summing to the quantity", () => {
    const parsed = addToCartSchema.safeParse({
      productId: PRODUCT,
      quantity: 30,
      breakdown: [
        { modelId: MODEL_A, qty: 10 },
        { custom: true, name: "Nokia 3310", qty: 20 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("trims and collapses whitespace in the typed name", () => {
    const parsed = addToCartSchema.safeParse({
      productId: PRODUCT,
      quantity: 10,
      breakdown: [{ custom: true, name: "  Nokia   3310\t ", qty: 10 }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.breakdown![0]).toEqual({
        custom: true,
        name: "Nokia 3310",
        qty: 10,
      });
    }
  });

  it("rejects an empty / whitespace-only typed name", () => {
    for (const name of ["", "   ", "\t\n"]) {
      const parsed = addToCartSchema.safeParse({
        productId: PRODUCT,
        quantity: 10,
        breakdown: [{ custom: true, name, qty: 10 }],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects a typed name beyond 80 characters", () => {
    const parsed = addToCartSchema.safeParse({
      productId: PRODUCT,
      quantity: 10,
      breakdown: [{ custom: true, name: "X".repeat(81), qty: 10 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("dedupes custom names case-insensitively — 'iphone 12' twice is blocked", () => {
    const parsed = addToCartSchema.safeParse({
      productId: PRODUCT,
      quantity: 20,
      breakdown: [
        { custom: true, name: "iPhone 12", qty: 10 },
        { custom: true, name: "IPHONE 12", qty: 10 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("custom quantities follow the same integer rules as master lines", () => {
    for (const qty of [0, -1, 1.5]) {
      const parsed = addToCartSchema.safeParse({
        productId: PRODUCT,
        quantity: 10,
        breakdown: [{ custom: true, name: "Nokia 3310", qty }],
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("legacy master-only payloads still parse exactly as before", () => {
    const parsed = addToCartSchema.safeParse({
      productId: PRODUCT,
      quantity: 10,
      breakdown: [{ modelId: MODEL_A, qty: 10 }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.breakdown![0]).toEqual({ modelId: MODEL_A, qty: 10 });
    }
  });
});
