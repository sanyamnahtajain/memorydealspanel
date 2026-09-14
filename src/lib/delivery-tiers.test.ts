import { describe, expect, it } from "vitest";

import {
  parseDeliveryRules,
  resolveDeliveryChargePaise,
  resolveDeliveryDisclosure,
  sortDeliveryTiers,
  tierChargePaise,
  type DeliveryRules,
  type DeliveryTier,
} from "./delivery";

const R = (rupees: number) => rupees * 100;

/** The owner's actual ladder. */
const LADDER: DeliveryTier[] = [
  { uptoPaise: R(10_000), chargePaise: R(250) },
  { uptoPaise: R(20_000), chargePaise: R(350) },
  { uptoPaise: R(50_000), chargePaise: R(500) },
  { uptoPaise: R(1_00_000), chargePaise: R(750) },
  { uptoPaise: null, chargePaise: R(1_000) },
];

const rules = (tiers: DeliveryTier[]): DeliveryRules => ({
  enabled: true,
  rules: [{ kind: "valueTiers", tiers }],
  note: null,
});

describe("the owner's ladder, band by band", () => {
  const cases: [number, number][] = [
    [0, 250],
    [5_000, 250],
    [9_999, 250],
    [10_000, 250], // INCLUSIVE bound: "till 10000" pays the 250 band
    [10_001, 350],
    [20_000, 350],
    [20_001, 500],
    [50_000, 500],
    [50_001, 750],
    [1_00_000, 750],
    [1_00_001, 1_000],
    [10_00_000, 1_000],
  ];

  for (const [goods, charge] of cases) {
    it(`₹${goods.toLocaleString("en-IN")} of goods → ₹${charge} delivery`, () => {
      expect(tierChargePaise(LADDER, R(goods))).toBe(R(charge));
    });
  }
});

describe("robustness the admin shouldn't have to think about", () => {
  it("resolves the same however the rows were entered", () => {
    const shuffled = [LADDER[3], LADDER[0], LADDER[4], LADDER[2], LADDER[1]];
    for (const goods of [5_000, 15_000, 35_000, 75_000, 5_00_000]) {
      expect(tierChargePaise(shuffled, R(goods))).toBe(
        tierChargePaise(LADDER, R(goods)),
      );
    }
  });

  it("puts the open-ended band last when sorting", () => {
    const sorted = sortDeliveryTiers([LADDER[4], LADDER[1], LADDER[0]]);
    expect(sorted[sorted.length - 1].uptoPaise).toBeNull();
  });

  it("charges the TOP band, not zero, when the open-ended row is missing", () => {
    // The expensive failure is shipping a huge order for free because a row
    // was never added — and free freight is the mistake nobody reports.
    const noOpenBand = LADDER.slice(0, 4);
    expect(tierChargePaise(noOpenBand, R(5_00_000))).toBe(R(750));
  });

  it("treats a negative or zero total as the lowest band", () => {
    expect(tierChargePaise(LADDER, -1)).toBe(R(250));
    expect(tierChargePaise(LADDER, 0)).toBe(R(250));
  });

  it("an empty ladder charges nothing rather than throwing", () => {
    expect(tierChargePaise([], R(5_000))).toBe(0);
  });
});

describe("how the ladder combines with the rest of the rules", () => {
  it("disabled delivery charges nothing, whatever the ladder says", () => {
    expect(
      resolveDeliveryChargePaise({ ...rules(LADDER), enabled: false }, R(50_000)),
    ).toBe(0);
  });

  it("a minCharge floor still applies underneath a ladder", () => {
    const both: DeliveryRules = {
      enabled: true,
      rules: [
        { kind: "minCharge", minChargePaise: R(400) },
        { kind: "valueTiers", tiers: LADDER },
      ],
      note: null,
    };
    // Band says 250, floor says 400 → 400.
    expect(resolveDeliveryChargePaise(both, R(5_000))).toBe(R(400));
    // Band says 750, above the floor → 750.
    expect(resolveDeliveryChargePaise(both, R(75_000))).toBe(R(750));
  });

  it("discloses exactly what it charges", () => {
    for (const goods of [5_000, 15_000, 75_000, 5_00_000]) {
      const charge = resolveDeliveryChargePaise(rules(LADDER), R(goods));
      expect(resolveDeliveryDisclosure(rules(LADDER), R(goods))).toEqual({
        minChargePaise: charge,
        note: null,
      });
    }
  });

  it("survives a round trip through the stored JSON", () => {
    const parsed = parseDeliveryRules(JSON.parse(JSON.stringify(rules(LADDER))));
    expect(resolveDeliveryChargePaise(parsed, R(35_000))).toBe(R(500));
  });

  it("a malformed ladder falls back to OFF rather than charging nonsense", () => {
    const parsed = parseDeliveryRules({
      enabled: true,
      rules: [{ kind: "valueTiers", tiers: [{ uptoPaise: "lots", chargePaise: 1 }] }],
      note: null,
    });
    expect(parsed.enabled).toBe(false);
  });
});
