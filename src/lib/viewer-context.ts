/**
 * The slice vocabulary for /api/me/context.
 *
 * The client names only the slices the current page actually renders, so a
 * product page still runs exactly the one access query it always did and
 * never pays for the home page's rails. Shared by both sides so a typo can't
 * silently disable a slice.
 */
export const CONTEXT_SLICES = {
  access: "access",
  lastOrder: "lastOrder",
  buyAgain: "buyAgain",
  priceLabels: "priceLabels",
} as const;

export type ContextSlice = (typeof CONTEXT_SLICES)[keyof typeof CONTEXT_SLICES];

const VALID = new Set<string>(Object.values(CONTEXT_SLICES));

/**
 * Parse `?want=access,buyAgain` into a validated set. Unknown names are
 * dropped rather than erroring — a stale client asking for a slice that no
 * longer exists should get the rest of its payload, not a failed page.
 */
export function parseSlices(raw: string | null): Set<ContextSlice> {
  const out = new Set<ContextSlice>();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (VALID.has(name)) out.add(name as ContextSlice);
  }
  return out;
}

/** Stable query string for a set of slices — stable so it dedupes cleanly. */
export function slicesParam(slices: Iterable<ContextSlice>): string {
  return [...new Set(slices)].sort().join(",");
}
