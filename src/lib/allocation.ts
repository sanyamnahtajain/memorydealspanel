import { z } from "zod";

import { objectIdSchema } from "@/lib/schemas/shared";

/**
 * Allocation — the per-model quantity-breakdown configuration.
 *
 * A product (or its category, as an inherited default) can require buyers to
 * split a cart line's quantity across device models: "50 tempered glasses =
 * 10 × Realme 11 + 10 × S23 Ultra + 30 × iPhone 15". The models come from the
 * DeviceModel master; this module is the PURE config layer shared by server
 * and client:
 *
 *   - the persisted JSON shape + defensive parser (never throws), and
 *   - the product-over-category inheritance rule.
 *
 * `kind` is an enum with one member today so a future allocation axis (say,
 * colours) is an additive change, not a schema break.
 */

export const allocationSchema = z.object({
  kind: z.literal("DEVICE_MODEL"),
  /** When true, a cart line for this product MUST carry a breakdown. */
  required: z.boolean(),
  /** Allowed model ids; EMPTY means every ACTIVE model is allowed. */
  modelIds: z.array(objectIdSchema).max(2000).default([]),
});

export type Allocation = z.infer<typeof allocationSchema>;

/** Parse a persisted JSON column into an Allocation, or null. Never throws. */
export function parseAllocation(raw: unknown): Allocation | null {
  if (raw == null) return null;
  const result = allocationSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * Resolve the effective allocation for a product:
 *   - the product's own config wins when set (INCLUDING `required: false`,
 *     which is the explicit "override the category default OFF" state);
 *   - `null` on the product inherits the category default;
 *   - no config anywhere ⇒ null (feature off — the overwhelming default).
 */
export function resolveEffectiveAllocation(
  productAllocation: unknown,
  categoryDefaultAllocation: unknown,
): Allocation | null {
  return (
    parseAllocation(productAllocation) ??
    parseAllocation(categoryDefaultAllocation)
  );
}

/**
 * The storefront-facing projection: enough for the UI to know a breakdown is
 * required and whether the model list is restricted — WITHOUT shipping a
 * potentially-huge id array to the client (the picker uses the search action,
 * which applies the restriction server-side).
 */
export interface PublicAllocation {
  kind: "DEVICE_MODEL";
  required: boolean;
  restricted: boolean;
}

export function toPublicAllocation(
  allocation: Allocation | null,
): PublicAllocation | null {
  if (!allocation || !allocation.required) return null;
  return {
    kind: allocation.kind,
    required: allocation.required,
    restricted: allocation.modelIds.length > 0,
  };
}
