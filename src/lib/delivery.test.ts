import { describe, expect, it } from "vitest";

import {
  DELIVERY_RULES_OFF,
  deliveryDisclosureCopy,
  parseDeliveryRules,
  parseStoredDeliveryDisclosure,
  resolveDeliveryDisclosure,
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
});
