/**
 * Discount allocation (pure) — ported from the tradeOS coupon engine.
 *
 * Split an order-level discount across lines PROPORTIONALLY to their totals,
 * in integer paise, by largest remainder: each line gets floor(D·lᵢ/T), then
 * the leftover paise go one each to the lines with the largest fractional
 * remainders (ties broken by line order). Invariants (for 0 ≤ D ≤ T):
 * Σ allocations === discountPaise EXACTLY, and 0 ≤ allocationᵢ ≤ lineTotalᵢ —
 * a discounted line is never negative and no paisa is lost or invented. GST
 * is then computed on the DISCOUNTED line amounts (tax on the post-discount
 * taxable value).
 */
export function allocateDiscount(
  lineTotals: readonly number[],
  discountPaise: number,
): number[] {
  const total = lineTotals.reduce((a, b) => a + b, 0);
  if (!Number.isInteger(discountPaise) || discountPaise < 0 || discountPaise > total) {
    throw new RangeError(
      `discountPaise must be an integer in [0, ${total}], got ${discountPaise}`,
    );
  }
  if (discountPaise === 0 || total === 0) return lineTotals.map(() => 0);

  const alloc = lineTotals.map((lt) => Math.floor((discountPaise * lt) / total));
  let remaining = discountPaise - alloc.reduce((a, b) => a + b, 0);

  // Largest fractional remainder first; stable on ties (earlier line wins).
  // Only lines with a NONZERO remainder ever receive a +1 (there are always
  // at least `remaining` of them), so a zero-total line stays at 0.
  const order = lineTotals
    .map((lt, i) => ({ i, rem: (discountPaise * lt) % total }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (let k = 0; remaining > 0; k++, remaining--) {
    alloc[order[k].i] += 1;
  }
  return alloc;
}
