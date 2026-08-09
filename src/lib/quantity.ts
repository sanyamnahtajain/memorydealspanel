import { MAX_QTY_PER_LINE, MIN_QTY_PER_LINE } from "@/lib/schemas/cart";

/**
 * Quantity clamping — THE single source of truth for how a requested quantity
 * meets a product's MOQ and pack multiple. Used by:
 *
 *   - src/server/services/cart.ts     (add / update mutations)
 *   - src/server/services/orders.ts   (re-validation at placement)
 *   - the storefront steppers         (AddToCartButton, CartView)
 *
 * Semantics (matches the pre-existing MOQ behaviour: clamp, never reject):
 *
 *   - MOQ is a floor: requests below it are raised to it.
 *   - `packMultiple` (≥ 2) means quantities must land on a multiple of it,
 *     counting from zero: pack 10 ⇒ 10, 20, 30… A request that is off-pack is
 *     rounded UP (25 → 30) — the wholesale expectation is "next full box".
 *   - The two compose: floor = the smallest pack multiple ≥ MOQ
 *     (MOQ 15 + pack 10 ⇒ 20).
 *   - The per-line ceiling still applies, and with a pack it is the LARGEST
 *     multiple ≤ MAX_QTY_PER_LINE, so the cap itself stays orderable.
 *   - null / 0 / 1 / invalid pack ⇒ no pack constraint (plain MOQ floor).
 *
 * Pure + isomorphic — no imports beyond the cart constants, so client
 * components can use it for instant stepper feedback and the server remains
 * authoritative with identical results.
 */

/** A pack multiple is meaningful only as an integer ≥ 2. */
export function normalisePack(pack: number | null | undefined): number {
  if (typeof pack !== "number" || !Number.isFinite(pack)) return 1;
  const p = Math.trunc(pack);
  return p >= 2 ? p : 1;
}

/** MOQ is optional; missing/invalid means the absolute floor of 1. */
export function normaliseMoq(moq: number | null | undefined): number {
  if (
    typeof moq !== "number" ||
    !Number.isFinite(moq) ||
    moq < MIN_QTY_PER_LINE
  ) {
    return MIN_QTY_PER_LINE;
  }
  return Math.min(Math.trunc(moq), MAX_QTY_PER_LINE);
}

/** The smallest orderable quantity for a unit: pack-aligned MOQ. */
export function minOrderableQty(
  moq: number | null | undefined,
  pack: number | null | undefined,
): number {
  const p = normalisePack(pack);
  const floor = normaliseMoq(moq);
  if (p === 1) return floor;
  const aligned = Math.ceil(floor / p) * p;
  // A degenerate config (pack > cap) still yields a sane value.
  return Math.min(aligned, maxOrderableQty(pack));
}

/** The largest orderable quantity: the cap, aligned DOWN onto the pack. */
export function maxOrderableQty(pack: number | null | undefined): number {
  const p = normalisePack(pack);
  if (p === 1) return MAX_QTY_PER_LINE;
  const aligned = Math.floor(MAX_QTY_PER_LINE / p) * p;
  // pack > MAX would align to 0; a single pack is then the only sane answer.
  return aligned >= p ? aligned : p;
}

/**
 * Clamp a requested quantity into the valid window for a unit. Non-finite
 * input lands on the minimum. Result is ALWAYS on-pack, ≥ the pack-aligned
 * MOQ, and ≤ the pack-aligned cap.
 */
export function clampQuantity(
  requested: number,
  moq: number | null | undefined,
  pack: number | null | undefined = null,
): number {
  const p = normalisePack(pack);
  const floorQty = minOrderableQty(moq, pack);
  const capQty = maxOrderableQty(pack);
  if (!Number.isFinite(requested)) return floorQty;

  let q = Math.max(Math.trunc(requested), floorQty);
  if (p > 1) q = Math.ceil(q / p) * p; // round UP to the next full pack
  return Math.min(Math.max(q, floorQty), capQty);
}
