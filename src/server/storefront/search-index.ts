import { prisma } from "@/server/db";
import { swrCached, resetSwrCache } from "@/server/cache/swr";
import { categoryNameMatchesQuery, termVariants } from "@/lib/search-normalize";

/**
 * In-memory storefront search index.
 *
 * WHY: every keystroke in the search sheet used to run four database reads
 * (session, categories, a regex scan JOINED to brands — a $lookup over the
 * whole catalogue on MongoDB — and a count of the same), queued one behind
 * the other as server actions. On a phone over 4G that was ~3 s from the last
 * key to a suggestion; retailers said "search slow hai".
 *
 * The searchable part of the catalogue is small and price-free (names,
 * brands, SKUs, tags, category, a thumbnail), so it is held in memory per
 * server instance, refreshed every minute and dropped on any admin product
 * save. Matching is the SAME forgiving contract as the database search
 * (src/server/dal/products.ts `searchWhere`): every term must hit name / SKU /
 * brand / tags in its singular or plural spelling, OR the whole query names a
 * category. On top, results are ranked by relevance instead of only by date.
 *
 * Nothing here is gated: no price, no stock count — safe for every viewer and
 * for a shared CDN cache.
 */

export interface IndexedProduct {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  thumbUrl: string | null;
  categoryId: string;
  /** Lower-cased name / SKU / brand strings, matched by substring. */
  fields: string[];
  /** Lower-cased name, for ranking. */
  nameLc: string;
  /** Tags as stored (matched exactly, like the database `has`). */
  tags: string[];
  createdAt: number;
}

export interface SearchIndex {
  products: IndexedProduct[];
  categories: { id: string; name: string }[];
}

const KEY = "search-index";

type ImageLike = { url?: string | null; thumbUrl?: string | null; isPrimary?: boolean | null };

async function build(): Promise<SearchIndex> {
  const [rows, categories] = await Promise.all([
    prisma.product.findMany({
      // Same visibility wall as the storefront DAL (VISIBLE_WHERE).
      where: { status: "ACTIVE", deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        sku: true,
        brand: true,
        tags: true,
        categoryId: true,
        createdAt: true,
        images: true,
        brandRef: { select: { name: true } },
      },
    }),
    prisma.category.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true } }),
  ]);

  const products = rows.map((row): IndexedProduct => {
    const images = (Array.isArray(row.images) ? row.images : []) as ImageLike[];
    const primary = images.find((img) => img?.isPrimary) ?? images[0] ?? null;
    const brandDisplay = row.brandRef?.name ?? row.brand ?? null;
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      brand: row.brand ?? null,
      thumbUrl: primary ? (primary.thumbUrl ?? primary.url ?? null) : null,
      categoryId: row.categoryId,
      fields: [row.name, row.sku, row.brand, brandDisplay]
        .filter((v): v is string => typeof v === "string" && v.length > 0)
        .map((v) => v.toLowerCase()),
      nameLc: row.name.toLowerCase(),
      tags: Array.isArray(row.tags) ? row.tags : [],
      createdAt: row.createdAt.getTime(),
    };
  });
  return { products, categories };
}

/** The index, or null when it could not be built in time (callers then use the database). */
export function loadSearchIndex(): Promise<SearchIndex | null> {
  return swrCached<SearchIndex | null>(KEY, build, {
    ttlMs: 60_000,
    coldBudgetMs: 6_000,
    fallback: null,
    label: "search index",
  });
}

/** Drop the index — the next search rebuilds it (admin product saves call this). */
export function resetSearchIndex(): void {
  resetSwrCache(KEY);
}

function isWordStart(haystack: string, at: number): boolean {
  return at === 0 || !/[a-z0-9]/.test(haystack[at - 1] ?? "");
}

/**
 * Rank every match for a query. Pure: same input, same output.
 *
 * Score, highest first: the name starts with the query and every word starts
 * a word in it; every word starts a word in the name; the name contains the
 * query; matched on SKU / brand / tags; matched only through its category.
 * Singular and plural spellings rank alike. Ties keep the
 * storefront's order (newest first, then id).
 */
export function searchIndexIds(index: SearchIndex, rawQuery: string): string[] {
  const q = rawQuery.trim().toLowerCase().replace(/\s+/g, " ");
  if (q.length === 0) return [];
  const terms = q.split(" ");
  const variants = terms.map(termVariants);
  const categoryIds = new Set(
    index.categories.filter((c) => categoryNameMatchesQuery(c.name, q)).map((c) => c.id),
  );

  const scored: { p: IndexedProduct; score: number }[] = [];
  for (const p of index.products) {
    const fieldsHit = variants.every((vs) =>
      vs.some((v) => p.fields.some((f) => f.includes(v)) || p.tags.includes(v)),
    );
    const categoryHit = categoryIds.has(p.categoryId);
    if (!fieldsHit && !categoryHit) continue;

    let score = 5;
    if (fieldsHit) {
      const startsWord = (v: string) => {
        for (let i = p.nameLc.indexOf(v); i !== -1; i = p.nameLc.indexOf(v, i + 1)) {
          if (isWordStart(p.nameLc, i)) return true;
        }
        return false;
      };
      // Singular / plural forms count alike, so "chargers" ranks like "charger".
      const everyWordStarts = variants.every((vs) => vs.some(startsWord));
      const nameStarts = variants[0].some((v) => p.nameLc.startsWith(v));
      if (everyWordStarts && nameStarts) score = 100;
      else if (everyWordStarts) score = 60;
      else if (p.nameLc.includes(q)) score = 40;
      else score = 20;
    }
    scored.push({ p, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.p.createdAt - a.p.createdAt ||
      (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0),
  );
  return scored.map((s) => s.p.id);
}

export interface Suggestion {
  id: string;
  name: string;
  slug: string;
  brand: string | null;
  thumbUrl: string | null;
}

/** The top few matches, in the shape the search sheet draws. */
export function suggestFromIndex(index: SearchIndex, query: string, limit = 8): Suggestion[] {
  const byId = new Map(index.products.map((p) => [p.id, p]));
  return searchIndexIds(index, query)
    .slice(0, limit)
    .map((id) => byId.get(id)!)
    .map(({ id, name, slug, brand, thumbUrl }) => ({ id, name, slug, brand, thumbUrl }));
}
