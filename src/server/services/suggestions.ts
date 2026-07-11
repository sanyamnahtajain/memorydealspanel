import { unstable_cache } from "next/cache";
import { prisma } from "@/server/db";

/**
 * Suggestion service — bounded DISTINCT queries that power the autocomplete
 * fields (spec keys, spec values-per-key, customer cities).
 *
 * WHY this shape:
 *   - The goal is typo reduction: as an admin types a spec key/value or a
 *     city, we surface values that ALREADY exist so they reuse the canonical
 *     spelling instead of inventing "Capacity" vs "capcity".
 *   - Every query is BOUNDED. `Product.specs` is a free-form Json blob (Mongo)
 *     that Prisma can't `DISTINCT`/`groupBy` into, so we fetch a capped page of
 *     rows and dedupe in memory. Cities go through Prisma `distinct` but are
 *     still capped. Nothing here scans the whole collection unbounded.
 *   - Results are wrapped in `unstable_cache` with a short revalidate so a
 *     burst of keystrokes hits the cache, not the DB. The cache key includes
 *     the argument (e.g. the spec key) so per-key value lists cache separately.
 *
 * These functions are transport-agnostic: authorization (assertAdmin) and the
 * public/curated city split live in `@/server/actions/suggestions`. Keeping the
 * service auth-free makes the dedupe/aggregation logic trivial to unit-test.
 */

/** Upper bound on product rows scanned for spec aggregation. */
const SPEC_SCAN_LIMIT = 2000;
/** Upper bound on distinct keys/values returned to the client. */
const SUGGESTION_LIMIT = 100;
/** Upper bound on customer rows scanned for city distinct. */
const CITY_SCAN_LIMIT = 2000;
/** Short cache window (seconds) — fresh enough, cheap under keystroke bursts. */
const REVALIDATE_SECONDS = 60;

/**
 * Case-insensitive, whitespace-trimmed dedupe that PRESERVES the first-seen
 * (canonical) casing. Sorted alphabetically (case-insensitive) and capped at
 * `limit`. Exported so it can be unit-tested directly and reused by callers
 * that already hold raw values.
 */
export function dedupeSuggestions(
  values: Iterable<unknown>,
  limit = SUGGESTION_LIMIT,
): string[] {
  const seen = new Map<string, string>();
  for (const raw of values) {
    if (raw == null) continue;
    const str = String(raw).trim();
    if (str === "") continue;
    const fold = str.toLowerCase();
    if (!seen.has(fold)) {
      seen.set(fold, str);
    }
  }
  return [...seen.values()]
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .slice(0, limit);
}

/**
 * Extracts the top-level keys from a stored specs value. A specs blob is a flat
 * `Record<string, string>`; anything that isn't a plain object yields nothing.
 * Exported for unit testing the aggregation in isolation.
 */
export function keysFromSpecs(specs: unknown): string[] {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) {
    return [];
  }
  return Object.keys(specs as Record<string, unknown>);
}

/**
 * Extracts the value stored for `key` in a specs blob, matched
 * case-insensitively so "RAM" and "ram" collapse to one lookup. Returns the
 * first matching value as a trimmed string, or null when absent/blank.
 * Exported for unit testing.
 */
export function valueForKey(specs: unknown, key: string): string | null {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) {
    return null;
  }
  const wanted = key.trim().toLowerCase();
  if (wanted === "") return null;
  for (const [k, v] of Object.entries(specs as Record<string, unknown>)) {
    if (k.trim().toLowerCase() === wanted) {
      if (v == null) return null;
      const str = String(v).trim();
      return str === "" ? null : str;
    }
  }
  return null;
}

/**
 * Distinct spec KEYS used across (non-deleted) products. Fetches a capped page
 * of specs blobs and aggregates their top-level keys in memory. Bounded by
 * SPEC_SCAN_LIMIT (rows) and SUGGESTION_LIMIT (keys returned).
 */
async function computeSpecKeys(): Promise<string[]> {
  const rows = await prisma.product.findMany({
    where: { deletedAt: null, specs: { not: undefined } },
    select: { specs: true },
    take: SPEC_SCAN_LIMIT,
    orderBy: { updatedAt: "desc" },
  });
  const all: string[] = [];
  for (const row of rows) {
    all.push(...keysFromSpecs(row.specs));
  }
  return dedupeSuggestions(all);
}

/**
 * Distinct VALUES used for a given spec key across (non-deleted) products.
 * Same bounded scan as keys; the key match is case-insensitive so the caller
 * doesn't have to know the canonical casing.
 */
async function computeSpecValues(key: string): Promise<string[]> {
  const trimmed = key.trim();
  if (trimmed === "") return [];
  const rows = await prisma.product.findMany({
    where: { deletedAt: null, specs: { not: undefined } },
    select: { specs: true },
    take: SPEC_SCAN_LIMIT,
    orderBy: { updatedAt: "desc" },
  });
  const all: string[] = [];
  for (const row of rows) {
    const v = valueForKey(row.specs, trimmed);
    if (v !== null) all.push(v);
  }
  return dedupeSuggestions(all);
}

/**
 * Distinct non-null customer cities. Uses Prisma `distinct` (bounded by
 * CITY_SCAN_LIMIT) then folds casing/whitespace variants together in memory so
 * "Mumbai" and " mumbai " collapse to one canonical entry.
 */
async function computeCities(): Promise<string[]> {
  const rows = await prisma.customer.findMany({
    where: { city: { not: null } },
    select: { city: true },
    distinct: ["city"],
    take: CITY_SCAN_LIMIT,
    orderBy: { city: "asc" },
  });
  return dedupeSuggestions(rows.map((r) => r.city));
}

/**
 * Cached public entrypoints. `unstable_cache` memoizes each result for
 * REVALIDATE_SECONDS keyed by the tag + arguments, so a stream of keystrokes
 * (the client filters locally anyway) never re-queries the DB.
 */
export const specKeys = unstable_cache(computeSpecKeys, ["suggestions:spec-keys"], {
  revalidate: REVALIDATE_SECONDS,
  tags: ["suggestions:spec-keys"],
});

export const cities = unstable_cache(computeCities, ["suggestions:cities"], {
  revalidate: REVALIDATE_SECONDS,
  tags: ["suggestions:cities"],
});

/**
 * Per-key value suggestions. `unstable_cache`'s key function folds the `key`
 * argument into the cache entry, so each spec key caches its own value list.
 */
export function specValues(key: string): Promise<string[]> {
  const normalized = key.trim().toLowerCase();
  const cached = unstable_cache(
    () => computeSpecValues(normalized),
    ["suggestions:spec-values", normalized],
    { revalidate: REVALIDATE_SECONDS, tags: ["suggestions:spec-values"] },
  );
  return cached();
}
