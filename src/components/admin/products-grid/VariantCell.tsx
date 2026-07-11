/**
 * VariantCell — variant-awareness helpers for the DealSheet product grid.
 *
 * WHY THIS EXISTS
 * ---------------
 * When a product `hasVariants`, its top-level `price` / `mrp` / `stockStatus`
 * are RECOMPUTED "FROM" values (the min active variant), not editable facts.
 * Editing them inline would fight the server-side recompute and corrupt data.
 * So for variant rows those three cells must read as *managed elsewhere*.
 *
 * The generic grid engine (owned by another builder) decides editability and
 * cell rendering strictly per-COLUMN — it exposes no per-ROW read-only hook and
 * no way to register a domain cell renderer from here. Rich per-cell chrome in
 * the grid body (a badge + link inside a price cell) is therefore not reachable
 * without engine changes we are not allowed to make.
 *
 * What IS reachable from the column config we own:
 *   - `format(value)` for display text (value-only, row-blind),
 *   - `compute(row)` for a read-only, ROW-AWARE derived column,
 *   - `validate(value, row)` to block a candidate edit with a message the
 *     engine surfaces as the cell's red-corner tooltip.
 *
 * This module centralises the copy + the derived label so `productColumns` and
 * `ProductGrid` stay in lock-step, and so the behaviour is unit-testable as a
 * pure function. The airtight integrity guarantee (never persisting a variant
 * row's price/mrp/stock) is enforced at the `onSave` boundary in `ProductGrid`,
 * because paste/fill bypass `validate` in the engine.
 */

import { formatPaise } from "@/lib/money";

/* -------------------------------------------------------------------------- */
/*  Shared copy                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The one canonical message shown when someone tries to edit a variant-managed
 * field, and as the read-only tooltip on those cells. Kept here so the inline
 * validator, the blocked-save toast, and any affordance all read identically.
 */
export const VARIANT_MANAGED_MESSAGE =
  "Managed per variant — open the product to edit";

/** The fields that become read-only (variant-managed) when `hasVariants`. */
export const VARIANT_MANAGED_FIELDS = [
  "price",
  "mrp",
  "stockStatus",
] as const;

export type VariantManagedField = (typeof VARIANT_MANAGED_FIELDS)[number];

/** True when `field` is one the variant recompute owns. */
export function isVariantManagedField(
  field: string,
): field is VariantManagedField {
  return (VARIANT_MANAGED_FIELDS as readonly string[]).includes(field);
}

/* -------------------------------------------------------------------------- */
/*  Derived display                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Label for the read-only "Variants" info column.
 *
 * For a variant product it reads e.g. `from ₹499.00 · 4 variants`, signalling
 * both that the price is a FROM floor and that editing lives per-variant. For a
 * plain product it reads an em dash (nothing to manage). The whole cell is a
 * `computed` column, so it is inherently read-only for every row — exactly what
 * we want for an at-a-glance indicator that never accepts input.
 *
 * @param hasVariants - whether the product is split into variants.
 * @param variantCount - number of variants (only meaningful when hasVariants).
 * @param fromPrice - the recomputed FROM price in integer paise (product.price),
 *   or `null` when the viewer isn't price-approved / no price is available.
 */
export function variantSummaryLabel(
  hasVariants: boolean,
  variantCount: number,
  fromPrice: number | null,
): string {
  if (!hasVariants) return "—";
  const count = Math.max(0, variantCount);
  const noun = count === 1 ? "variant" : "variants";
  const pricePart =
    fromPrice != null ? `from ${formatPaise(fromPrice)} · ` : "";
  return `${pricePart}${count} ${noun}`;
}

/** Short "N variants" badge text for compact affordances. */
export function variantCountBadge(variantCount: number): string {
  const count = Math.max(0, variantCount);
  return `${count} ${count === 1 ? "variant" : "variants"}`;
}
