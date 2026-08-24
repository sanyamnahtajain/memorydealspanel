import { z } from "zod";

/**
 * Delivery rules (owner request) — runtime-configurable from the admin panel.
 *
 * TODAY there is one rule: a MINIMUM delivery charge (₹250) that is always
 * collected, with the final courier charge depending on parcel weight, size
 * and the delivery PIN code. That minimum is CHARGED — it is a real line in the
 * cart and order money (see {@link resolveDeliveryChargePaise}) — and it is
 * still DISCLOSED everywhere (cart, order pages, staff PDF) as a MINIMUM that
 * can rise; anything above it is settled at dispatch.
 *
 * SCALABLE SHAPE: `rules` is a tagged-union array like billing groups — a
 * future weight/PIN-code tier is a new `kind`, not a schema change. Orders
 * FREEZE the disclosure at placement so history never shifts when the admin
 * edits the rules.
 */

export const deliveryRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("minCharge"),
    /** Integer paise — the floor always collected. */
    minChargePaise: z.number().int().min(0).max(100_000_00),
  }),
]);

export const deliveryRulesSchema = z.object({
  enabled: z.boolean(),
  rules: z.array(deliveryRuleSchema).max(10),
  /** Extra line shown under the charge (simple English, optional). */
  note: z.string().trim().max(300).nullable(),
});

export type DeliveryRules = z.infer<typeof deliveryRulesSchema>;
export type DeliveryRulesInput = z.input<typeof deliveryRulesSchema>;

/** Absent/malformed config resolves to OFF — a safe deploy shows nothing. */
export const DELIVERY_RULES_OFF: DeliveryRules = {
  enabled: false,
  rules: [{ kind: "minCharge", minChargePaise: 250_00 }],
  note: null,
};

export function parseDeliveryRules(value: unknown): DeliveryRules {
  const parsed = deliveryRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : DELIVERY_RULES_OFF;
}

/**
 * What the storefront/PDF must disclose, resolved from the rules. Null when
 * the feature is off or no minimum applies.
 */
export interface DeliveryDisclosure {
  minChargePaise: number;
  note: string | null;
}

export function resolveDeliveryDisclosure(rules: DeliveryRules): DeliveryDisclosure | null {
  if (!rules.enabled) return null;
  const min = rules.rules.find((r) => r.kind === "minCharge");
  if (!min || min.minChargePaise <= 0) return null;
  return { minChargePaise: min.minChargePaise, note: rules.note };
}

/**
 * The delivery CHARGE for an order, in integer paise, resolved from the rules.
 *
 * A function over the tagged union (not a field read) so a future rule kind —
 * weight tiers, PIN-code zones, free-above-X — slots in HERE and every call
 * site keeps working unchanged. Today the only kind is `minCharge`, so the
 * charge is simply its floor.
 *
 * Returns 0 when delivery is disabled or nothing applies, which is what makes
 * "delivery off" byte-for-byte identical to the pre-charge behaviour.
 *
 * ORDER OF OPERATIONS (enforced by the caller, see src/server/services/orders.ts):
 * this is a CHARGE, not goods. It is added AFTER the goods subtotal, AFTER any
 * billing-group discount and AFTER any coupon — no discount may ever reduce it.
 */
/**
 * GST ON FREIGHT — READ BEFORE CHANGING THIS.
 *
 * The charge is added AFTER the goods total, which already includes GST. In
 * other words delivery is currently OUTSIDE the taxable base and is not taxed.
 *
 * That is a deliberate, conservative choice, not a considered tax opinion.
 * Under Indian GST, freight charged on a taxable supply is often treated as
 * part of the composite supply and taxed at the rate of the principal goods —
 * so the correct treatment here is a decision for the owner and his
 * accountant, and it may differ from what this does today.
 *
 * If it must be taxed, the change belongs in the GST pipeline (src/lib/gst.ts)
 * where the taxable base is built — NOT here, and not by quietly adding a rate
 * to the delivery rules.
 */
export function resolveDeliveryChargePaise(rules: DeliveryRules): number {
  if (!rules.enabled) return 0;
  let paise = 0;
  for (const rule of rules.rules) {
    // One branch per rule kind — add the next kind here, nowhere else.
    if (rule.kind === "minCharge") {
      // The floor always collected. `Math.max` (not `+=`) so a duplicated
      // minCharge rule can never silently double-charge the customer.
      paise = Math.max(paise, rule.minChargePaise);
    }
  }
  return paise > 0 ? paise : 0;
}

/**
 * Defensive read of a FROZEN `Order.deliveryChargePaise`. Orders placed before
 * delivery became a charged line have no value at all — they must read as 0 so
 * their totals never move.
 */
export function frozenDeliveryChargePaise(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

/** Defensive read of the frozen Order.deliveryDisclosure JSON. */
export function parseStoredDeliveryDisclosure(value: unknown): DeliveryDisclosure | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<DeliveryDisclosure>;
  if (typeof v.minChargePaise !== "number" || v.minChargePaise <= 0) return null;
  return {
    minChargePaise: v.minChargePaise,
    note: typeof v.note === "string" ? v.note : null,
  };
}

/**
 * The standard disclosure copy (SIMPLE ENGLISH — owner request). `amount` is
 * the already-formatted rupee string.
 *
 * `charged` picks the wording for the two eras:
 *  - `false` (default) — the DISCLOSED-ONLY wording, kept verbatim so an order
 *    placed before delivery became a real money line still reads exactly as it
 *    did on the day it was placed;
 *  - `true` — delivery is a line in the total. The amount is still a MINIMUM
 *    and the weight/size/PIN-code caveat stays, so nobody reads it as final.
 */
export function deliveryDisclosureCopy(
  amount: string,
  { charged = false }: { charged?: boolean } = {},
): {
  title: string;
  detail: string;
} {
  if (charged) {
    return {
      title: `Delivery (minimum): ${amount} — added to your total`,
      detail:
        "This is the minimum. The final delivery charge depends on the parcel weight, parcel size and your PIN code. If it comes to more, we will confirm it with you before dispatch.",
    };
  }
  return {
    title: `Delivery charge: at least ${amount} extra`,
    detail:
      "The final delivery charge depends on the parcel weight, parcel size and your PIN code. We will confirm it with your order.",
  };
}

/** The short caveat printed beside the "Delivery (minimum)" money row. */
export const DELIVERY_MINIMUM_CAVEAT =
  "Minimum charge. The final cost depends on parcel weight, parcel size and your PIN code.";
