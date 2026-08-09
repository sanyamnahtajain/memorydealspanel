import { z } from "zod";

import { objectIdSchema } from "./shared";

/**
 * Cart input schemas + caps — the client-side/server-side contract for cart
 * mutations.
 *
 * ANTI-CHEAT: the client is ONLY ever allowed to send `{ productId, variantId?,
 * quantity }`. A price is NEVER accepted from the client — unit prices, line
 * totals and the subtotal are computed server-side at read/placement from the
 * viewer-gated DAL (see src/server/services/cart.ts). Any price-shaped field in
 * a request is simply not part of this schema, so it is dropped by `.parse`.
 *
 * Quantity is validated as a POSITIVE, SAFE INTEGER within [1, MAX_QTY_PER_LINE]
 * (the MOQ floor is applied server-side against the live product, since it
 * varies per product and must not be trusted from the client). Non-integers,
 * negatives, zero, NaN, Infinity and absurd magnitudes are all rejected here
 * before any DB work happens.
 */

/** Hard ceiling on the quantity of a single cart line. */
export const MAX_QTY_PER_LINE = 100_000;

/** Absolute floor — a line must carry at least one unit. */
export const MIN_QTY_PER_LINE = 1;

/** Max number of DISTINCT lines (product/variant pairs) a cart may hold. */
export const MAX_CART_LINES = 100;

/** Max length of the free-text note attached to an order at placement. */
export const MAX_CART_NOTE_LENGTH = 500;

/**
 * A positive, safe integer quantity within the per-line cap. Rejects
 * floats/NaN/Infinity/negatives/zero and anything above the ceiling. Coerces
 * nothing — a caller must send a real number, never a numeric string, so a
 * malformed client can't slip a string through.
 */
export const quantitySchema = z
  .number({ error: "Quantity must be a number." })
  .int("Quantity must be a whole number.")
  .min(MIN_QTY_PER_LINE, `Quantity must be at least ${MIN_QTY_PER_LINE}.`)
  .max(MAX_QTY_PER_LINE, `Quantity cannot exceed ${MAX_QTY_PER_LINE}.`)
  // `.int()` already rejects non-finite values, but be explicit about safety.
  .refine((v) => Number.isSafeInteger(v), "Quantity is out of range.");

/**
 * Add-to-cart / update-line input. `variantId` is optional — present only for
 * products split into purchasable variants. NO price field exists on this
 * schema by design.
 */
/** Max distinct models a single line's breakdown may reference. */
export const MAX_BREAKDOWN_ENTRIES = 500;

/** One per-model slice of a line's quantity. Strict positive integers only. */
export const breakdownEntrySchema = z.object({
  modelId: objectIdSchema,
  qty: z
    .number()
    .int("Model quantity must be a whole number.")
    .min(1, "Each model needs at least 1 unit.")
    .max(MAX_QTY_PER_LINE)
    .refine((v) => Number.isSafeInteger(v), "Model quantity is out of range."),
});

/**
 * A per-model quantity breakdown. Distinct model ids; the SUM must equal the
 * line quantity — enforced by the superRefine on the mutation schemas below,
 * and re-validated server-side (the schema is a first gate, not the last).
 */
export const breakdownSchema = z
  .array(breakdownEntrySchema)
  .min(1, "Pick at least one model.")
  .max(MAX_BREAKDOWN_ENTRIES)
  .refine(
    (entries) => new Set(entries.map((e) => e.modelId)).size === entries.length,
    "Each model may appear only once.",
  );
export type BreakdownInput = z.infer<typeof breakdownSchema>;

const withBreakdownSum = <T extends z.ZodRawShape>(shape: z.ZodObject<T>) =>
  shape.superRefine((value, ctx) => {
    const v = value as { quantity: number; breakdown?: BreakdownInput };
    if (!v.breakdown) return;
    const sum = v.breakdown.reduce((acc, e) => acc + e.qty, 0);
    if (sum !== v.quantity) {
      ctx.addIssue({
        code: "custom",
        path: ["breakdown"],
        message: "The per-model quantities must add up to the total quantity.",
      });
    }
  });

export const addToCartSchema = withBreakdownSum(
  z.object({
    productId: objectIdSchema,
    variantId: objectIdSchema.optional(),
    quantity: quantitySchema,
    /** Per-model split — REQUIRED by allocation products (validated server-side). */
    breakdown: breakdownSchema.optional(),
  }),
);
export type AddToCartInput = z.infer<typeof addToCartSchema>;

/** Update-quantity input — same shape as add (the server sets, not increments). */
export const updateQuantitySchema = addToCartSchema;
export type UpdateQuantityInput = z.infer<typeof updateQuantitySchema>;

/** Identify a single cart line for removal (no quantity needed). */
export const cartLineRefSchema = z.object({
  productId: objectIdSchema,
  variantId: objectIdSchema.optional(),
});
export type CartLineRef = z.infer<typeof cartLineRefSchema>;
