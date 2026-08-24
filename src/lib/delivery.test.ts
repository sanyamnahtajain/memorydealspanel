import { describe, expect, it } from "vitest";

import {
  DELIVERY_RULES_OFF,
  deliveryDisclosureCopy,
  frozenDeliveryChargePaise,
  parseDeliveryRules,
  parseStoredDeliveryDisclosure,
  resolveDeliveryChargePaise,
  resolveDeliveryDisclosure,
  type DeliveryRules,
} from "./delivery";

describe("parseDeliveryRules", () => {
  it("absent / malformed resolves to OFF (safe deploy)", () => {
    for (const bad of [null, undefined, {}, "x", { enabled: "yes" }]) {
      expect(parseDeliveryRules(bad)).toEqual(DELIVERY_RULES_OFF);
    }
    expect(parseDeliveryRules(null).enabled).toBe(false);
  });

  it("round-trips a valid config", () => {
    const valid = {
      enabled: true,
      rules: [{ kind: "minCharge" as const, minChargePaise: 250_00 }],
      note: "Free above ₹50,000.",
    };
    expect(parseDeliveryRules(valid)).toEqual(valid);
  });
});

describe("resolveDeliveryDisclosure", () => {
  it("null while off, and for a zero minimum", () => {
    expect(resolveDeliveryDisclosure(DELIVERY_RULES_OFF)).toBeNull();
    expect(
      resolveDeliveryDisclosure({
        enabled: true,
        rules: [{ kind: "minCharge", minChargePaise: 0 }],
        note: null,
      }),
    ).toBeNull();
  });

  it("surfaces the minimum + note when enabled", () => {
    expect(
      resolveDeliveryDisclosure({
        enabled: true,
        rules: [{ kind: "minCharge", minChargePaise: 250_00 }],
        note: "n",
      }),
    ).toEqual({ minChargePaise: 250_00, note: "n" });
  });
});

describe("frozen disclosure + copy", () => {
  it("parses the stored order JSON defensively", () => {
    expect(parseStoredDeliveryDisclosure(null)).toBeNull();
    expect(parseStoredDeliveryDisclosure({ minChargePaise: 0 })).toBeNull();
    expect(parseStoredDeliveryDisclosure({ minChargePaise: 250_00 })).toEqual({
      minChargePaise: 250_00,
      note: null,
    });
  });

  it("copy is simple English and names the amount", () => {
    const copy = deliveryDisclosureCopy("₹250.00");
    expect(copy.title).toBe("Delivery charge: at least ₹250.00 extra");
    expect(copy.detail).toContain("PIN code");
  });

  it("the CHARGED copy says it is in the total and still calls it a minimum", () => {
    const copy = deliveryDisclosureCopy("₹250", { charged: true });
    expect(copy.title).toContain("₹250");
    expect(copy.title).toContain("added to your total");
    // The caveat must survive: it is a MINIMUM, not the final courier cost.
    expect(copy.title.toLowerCase()).toContain("minimum");
    expect(copy.detail).toContain("minimum");
    expect(copy.detail).toContain("parcel weight");
    expect(copy.detail).toContain("parcel size");
    expect(copy.detail).toContain("PIN code");
  });

  it("the default copy is UNCHANGED (historical orders keep their wording)", () => {
    expect(deliveryDisclosureCopy("₹250.00")).toEqual(
      deliveryDisclosureCopy("₹250.00", { charged: false }),
    );
  });
});

describe("resolveDeliveryChargePaise", () => {
  const on = (minChargePaise: number, note: string | null = null): DeliveryRules => ({
    enabled: true,
    rules: [{ kind: "minCharge", minChargePaise }],
    note,
  });

  it("delivery OFF charges nothing — even with a minimum configured", () => {
    expect(resolveDeliveryChargePaise(DELIVERY_RULES_OFF)).toBe(0);
    expect(DELIVERY_RULES_OFF.rules[0]).toEqual({
      kind: "minCharge",
      minChargePaise: 250_00,
    });
    expect(resolveDeliveryChargePaise({ ...on(250_00), enabled: false })).toBe(0);
  });

  it("delivery ON charges the configured minimum", () => {
    expect(resolveDeliveryChargePaise(on(250_00))).toBe(250_00);
    expect(resolveDeliveryChargePaise(on(1_00))).toBe(1_00);
  });

  it("no rules, or a zero minimum, charges nothing", () => {
    expect(resolveDeliveryChargePaise({ enabled: true, rules: [], note: null })).toBe(0);
    expect(resolveDeliveryChargePaise(on(0))).toBe(0);
  });

  it("a duplicated minCharge rule charges ONCE (the highest), never the sum", () => {
    const charge = resolveDeliveryChargePaise({
      enabled: true,
      rules: [
        { kind: "minCharge", minChargePaise: 250_00 },
        { kind: "minCharge", minChargePaise: 300_00 },
      ],
      note: null,
    });
    expect(charge).toBe(300_00);
    expect(charge).not.toBe(550_00);
  });

  it("agrees with the disclosure: charged exactly when something is disclosed", () => {
    for (const rules of [DELIVERY_RULES_OFF, on(0), on(250_00), on(999_00)]) {
      const disclosure = resolveDeliveryDisclosure(rules);
      const charge = resolveDeliveryChargePaise(rules);
      expect(charge > 0).toBe(disclosure !== null);
      if (disclosure) expect(charge).toBe(disclosure.minChargePaise);
    }
  });

  it("returns integer paise (money is never a float here)", () => {
    expect(Number.isSafeInteger(resolveDeliveryChargePaise(on(250_00)))).toBe(true);
  });
});

describe("frozenDeliveryChargePaise", () => {
  it("a pre-feature order (missing value) reads as 0 — its total cannot move", () => {
    for (const missing of [undefined, null, "250", NaN, Infinity, 12.5, -100]) {
      expect(frozenDeliveryChargePaise(missing)).toBe(0);
    }
  });

  it("reads a frozen charge verbatim", () => {
    expect(frozenDeliveryChargePaise(250_00)).toBe(250_00);
    expect(frozenDeliveryChargePaise(0)).toBe(0);
  });
});
