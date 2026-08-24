import { z } from "zod";

/**
 * Delivery rules (owner request) — runtime-configurable from the admin panel.
 *
 * TODAY there is one rule: a MINIMUM delivery charge (₹250) that is always
 * collected, with the final courier charge depending on parcel weight, size
 * and the delivery PIN code. The order flow DISCLOSES this everywhere (cart,
 * order pages, staff PDF) rather than adding it into the goods total — the
 * exact charge is settled at dispatch, like the rest of a purchase request.
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
 */
export function deliveryDisclosureCopy(amount: string): {
  title: string;
  detail: string;
} {
  return {
    title: `Delivery charge: at least ${amount} extra`,
    detail:
      "The final delivery charge depends on the parcel weight, parcel size and your PIN code. We will confirm it with your order.",
  };
}
