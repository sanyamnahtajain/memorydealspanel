import { z } from "zod";

import { GROUP_COLORS } from "@/lib/billing-groups/types";
import { objectIdSchema } from "@/lib/schemas/shared";

/**
 * Admin input for a billing group (create/update). Validated on the server
 * action before anything touches the DB. Rupee amounts arrive as integer
 * paise (the money inputs convert), percentages as basis points.
 */

export const discountTierSchema = z.object({
  fromPaise: z.number().int().min(0, "Floor can't be negative").max(1_000_000_000_00),
  percentBps: z
    .number()
    .int()
    .min(0, "Discount can't be negative")
    .max(10_000, "Discount can't exceed 100%"),
});

export const tieredPercentRuleSchema = z.object({
  kind: z.literal("tieredPercent"),
  tiers: z
    .array(discountTierSchema)
    .min(1, "Add at least one tier")
    .max(10, "At most 10 tiers")
    .superRefine((tiers, ctx) => {
      const sorted = tiers.slice().sort((a, b) => a.fromPaise - b.fromPaise);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].fromPaise === sorted[i - 1].fromPaise) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Two tiers start at the same amount",
          });
          return;
        }
        if (sorted[i].percentBps <= sorted[i - 1].percentBps) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "A higher tier must give a bigger discount than the one below it",
          });
          return;
        }
      }
    }),
});

export const billingGroupRuleSchema = z.discriminatedUnion("kind", [tieredPercentRuleSchema]);

export const billingGroupMatcherSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("brands"),
    brandIds: z.array(objectIdSchema).min(1, "Pick at least one brand").max(200),
  }),
]);

export const billingGroupInputSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(60, "Name is too long"),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,6}$/, "2–6 letters or digits (e.g. DLR)")
    .refine((c) => c !== "GEN", { message: "GEN is reserved for the General bucket" }),
  color: z.enum(GROUP_COLORS),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
  matcher: billingGroupMatcherSchema,
  rules: z.array(billingGroupRuleSchema).max(5),
  separateBill: z.boolean(),
  couponStacking: z.boolean(),
  notes: z.string().trim().max(500).nullable(),
});

export type BillingGroupInput = z.infer<typeof billingGroupInputSchema>;

/* ------------------------------------------------------------------ */
/* Action result types (kept here — "use server" modules export only   */
/* async functions)                                                    */
/* ------------------------------------------------------------------ */

export type BillingGroupActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type BillingGroupSimpleResult = { ok: true } | { ok: false; error: string };

export type BillingGroupImpactResult =
  | { ok: true; liveCarts: number }
  | { ok: false; error: string };
