import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/server/db";
import { getDeliveryTerms, updateDeliveryRules } from "./store-settings";
import type { DeliveryRules } from "@/lib/delivery";

/**
 * The owner's ladder through the REAL settings row and the real read path —
 * the same call `placeOrder` makes. Proves the charge a customer is actually
 * billed, not just the arithmetic.
 */

const R = (rupees: number) => rupees * 100;

const LADDER: DeliveryRules = {
  enabled: true,
  rules: [
    {
      kind: "valueTiers",
      tiers: [
        { uptoPaise: R(10_000), chargePaise: R(250) },
        { uptoPaise: R(20_000), chargePaise: R(350) },
        { uptoPaise: R(50_000), chargePaise: R(500) },
        { uptoPaise: R(1_00_000), chargePaise: R(750) },
        { uptoPaise: null, chargePaise: R(1_000) },
      ],
    },
  ],
  note: null,
};

afterAll(async () => {
  await prisma.storeSettings.updateMany({ data: { deliveryRules: null } });
});

describe("the ladder, saved and read back like production does", () => {
  it("charges each band correctly through getDeliveryTerms", async () => {
    await updateDeliveryRules(LADDER);

    const cases: [number, number][] = [
      [5_000, 250],
      [10_000, 250],
      [10_001, 350],
      [35_000, 500],
      [1_00_000, 750],
      [2_50_000, 1_000],
    ];

    for (const [goods, charge] of cases) {
      const terms = await getDeliveryTerms(R(goods));
      expect(terms.chargePaise).toBe(R(charge));
      // What we show must equal what we take.
      expect(terms.disclosure?.minChargePaise).toBe(R(charge));
    }
  });

  it("turning delivery off charges nothing, ladder or not", async () => {
    await updateDeliveryRules({ ...LADDER, enabled: false });
    const terms = await getDeliveryTerms(R(50_000));
    expect(terms.chargePaise).toBe(0);
    expect(terms.disclosure).toBeNull();
  });

  it("a flat minimum still works — the ladder is opt-in, not a migration", async () => {
    await updateDeliveryRules({
      enabled: true,
      rules: [{ kind: "minCharge", minChargePaise: R(250) }],
      note: null,
    });
    // A flat rule ignores the amount entirely: same charge at every size.
    for (const goods of [1_000, 50_000, 5_00_000]) {
      expect((await getDeliveryTerms(R(goods))).chargePaise).toBe(R(250));
    }
  });

  it("omitting the amount keeps the pre-ladder behaviour for flat rules", async () => {
    // Every existing caller that doesn't pass a total must be unaffected.
    expect((await getDeliveryTerms()).chargePaise).toBe(R(250));
  });
});
