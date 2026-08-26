/**
 * Shared parsing for the /api/price-labels endpoint (see the route header for
 * the contract). Pure so it can be unit-tested without a request.
 */

/** Hard cap: three home rails × 8 cards, with headroom. */
export const MAX_PRICE_LABEL_IDS = 48;

const OBJECT_ID = /^[0-9a-f]{24}$/;

/**
 * Parses the `ids` query param ("a,b,c") into a deduped list of well-formed
 * Mongo object ids, capped at {@link MAX_PRICE_LABEL_IDS}. Anything malformed
 * is silently dropped — a hostile id never reaches a query.
 */
export function parsePriceLabelIds(raw: string | null): string[] {
  if (!raw) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (!OBJECT_ID.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PRICE_LABEL_IDS) break;
  }
  return out;
}
