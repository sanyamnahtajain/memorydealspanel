import type { StockStatus } from "@/lib/schemas/shared";

/**
 * URL-param helpers for the context-scoped listing filters (chip bar + bottom
 * sheet). PURE — no React, no server imports — so the same parsing runs in the
 * client chip bar and in the server pages, and is unit-testable.
 *
 * Param contract (kept compatible with the discovery filter system in
 * `src/components/storefront/filters/types.ts`):
 *   - `brand` — comma-joined Brand master ids (category page's brand chips).
 *   - `cat`   — comma-joined Category ids (brand page's category chips).
 *   - `stock` — comma-joined stock statuses.
 * Repeated params AND comma-joined values are both accepted (hand-edited /
 * shared links); the writer always emits one comma-joined value.
 */
export const CONTEXT_FILTER_PARAMS = {
  brand: "brand",
  category: "cat",
  stock: "stock",
} as const;

/** Parse a multi-value param: repeated keys or comma-joined, trimmed, deduped. */
export function parseListParam(params: URLSearchParams, key: string): string[] {
  const out: string[] = [];
  for (const raw of params.getAll(key)) {
    for (const part of raw.split(",")) {
      const v = part.trim();
      if (v) out.push(v);
    }
  }
  return Array.from(new Set(out));
}

/**
 * Write a multi-value param back (comma-joined). Empty selection REMOVES the
 * key so a clean URL stays clean. Returns the same instance for chaining.
 */
export function writeListParam(
  params: URLSearchParams,
  key: string,
  values: readonly string[],
): URLSearchParams {
  const clean = Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
  if (clean.length === 0) params.delete(key);
  else params.set(key, clean.join(","));
  return params;
}

/** Toggle one value in a selection list (used by the chips). */
export function toggleListValue<T extends string>(
  values: readonly T[],
  value: T,
  next: boolean,
): T[] {
  const has = values.includes(value);
  if (next && !has) return [...values, value];
  if (!next && has) return values.filter((v) => v !== value);
  return [...values];
}

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

/**
 * True for a well-formed Mongo ObjectId. The pages filter every id that came
 * from the URL through this BEFORE it reaches a Prisma `in` filter — a
 * malformed id in a hand-edited link must narrow to nothing, never throw.
 */
export function isObjectId(value: string): boolean {
  return OBJECT_ID_RE.test(value);
}

const STOCK_VALUES: readonly StockStatus[] = [
  "IN_STOCK",
  "LOW",
  "OUT_OF_STOCK",
] as const;

function isStockStatus(value: string): value is StockStatus {
  return (STOCK_VALUES as readonly string[]).includes(value);
}

/** Parse the `stock` param down to valid statuses only. */
export function parseStockParam(params: URLSearchParams): StockStatus[] {
  return parseListParam(params, CONTEXT_FILTER_PARAMS.stock).filter(isStockStatus);
}

/** Simple-English labels for the stock rows (customer-visible copy). */
export const STOCK_ROW_LABELS: Record<StockStatus, string> = {
  IN_STOCK: "In stock",
  LOW: "Low stock",
  OUT_OF_STOCK: "Out of stock",
};
