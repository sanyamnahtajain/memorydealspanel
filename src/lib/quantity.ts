import { MAX_QTY_PER_LINE, MIN_QTY_PER_LINE } from "@/lib/schemas/cart";

/**
 * Quantity clamping — THE single source of truth for how a requested quantity
 * meets a product's MOQ, pack multiple, and max-qty cap. Used by:
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
 *   - `maxQty` is the ADMIN-defined per-line ceiling; absent/invalid means
 *     the platform default of DEFAULT_MAX_QTY (200). The admin value always
 *     wins, in either direction, bounded by the absolute MAX_QTY_PER_LINE.
 *     With a pack the cap is the LARGEST multiple ≤ the ceiling, so the cap
 *     itself stays orderable (never below one pack).
 *   - null / 0 / 1 / invalid pack ⇒ no pack constraint (plain MOQ floor).
 *   - A degenerate config (MOQ above the cap) resolves to the cap: the
 *     ceiling is authoritative.
 *
 * Pure + isomorphic — no imports beyond the cart constants, so client
 * components can use it for instant stepper feedback and the server remains
 * authoritative with identical results.
 */

/** The per-line ceiling when the admin hasn't set one. */
export const DEFAULT_MAX_QTY = 200;

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

/** The admin cap, defaulted (200) and bounded by the absolute maximum. */
export function normaliseMaxQty(maxQty: number | null | undefined): number {
  if (typeof maxQty !== "number" || !Number.isFinite(maxQty) || maxQty < 1) {
    return DEFAULT_MAX_QTY;
  }
  return Math.min(Math.trunc(maxQty), MAX_QTY_PER_LINE);
}

/** The largest orderable quantity: the cap, aligned DOWN onto the pack. */
export function maxOrderableQty(
  pack: number | null | undefined,
  maxQty: number | null | undefined = null,
): number {
  const p = normalisePack(pack);
  const cap = normaliseMaxQty(maxQty);
  if (p === 1) return cap;
  const aligned = Math.floor(cap / p) * p;
  // Cap below one pack would align to 0; a single pack is the sane answer.
  return aligned >= p ? aligned : p;
}

/** The smallest orderable quantity for a unit: pack-aligned MOQ (≤ the cap). */
export function minOrderableQty(
  moq: number | null | undefined,
  pack: number | null | undefined,
  maxQty: number | null | undefined = null,
): number {
  const p = normalisePack(pack);
  const floor = normaliseMoq(moq);
  const aligned = p === 1 ? floor : Math.ceil(floor / p) * p;
  // A degenerate config (MOQ above the admin cap) resolves to the cap.
  return Math.min(aligned, maxOrderableQty(pack, maxQty));
}

/**
 * The next pack-aligned quantity STRICTLY ABOVE `qty` — the "+" / "+pack"
 * stepper action. From an off-pack value it lands on the next multiple
 * (15 → 20 at pack 10), so one tap always repairs alignment upward.
 * Junk/negative input yields one pack.
 */
export function stepQtyUp(
  qty: number,
  pack: number | null | undefined,
): number {
  const p = normalisePack(pack);
  if (!Number.isFinite(qty) || qty < 0) return p;
  const q = Math.trunc(qty);
  return Math.min(Math.floor(q / p) * p + p, MAX_QTY_PER_LINE);
}

/**
 * The previous pack-aligned quantity STRICTLY BELOW `qty` — the "−" stepper
 * action. Off-pack values land on the multiple below (15 → 10 at pack 10);
 * stepping below one pack yields 0, which callers treat as "remove the row".
 */
export function stepQtyDown(
  qty: number,
  pack: number | null | undefined,
): number {
  const p = normalisePack(pack);
  if (!Number.isFinite(qty)) return 0;
  const q = Math.trunc(qty);
  if (q <= p) return 0;
  return Math.ceil(q / p) * p - p;
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
  maxQty: number | null | undefined = null,
): number {
  const p = normalisePack(pack);
  const floorQty = minOrderableQty(moq, pack, maxQty);
  const capQty = maxOrderableQty(pack, maxQty);
  if (!Number.isFinite(requested)) return floorQty;

  let q = Math.max(Math.trunc(requested), floorQty);
  if (p > 1) q = Math.ceil(q / p) * p; // round UP to the next full pack
  return Math.min(Math.max(q, floorQty), capQty);
}
