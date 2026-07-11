import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { canSeePrices, type ViewerContext } from "@/server/types/viewer";

/**
 * Facet (filter) computation Data Access Layer — the aggregation half of
 * discovery & search (PRD 7.7).
 *
 * Facets are the counts that power the storefront filter rail: how many active
 * products belong to each brand, sit in each stock bucket, carry each tag, and
 * expose each spec value. Every facet here is PRICE-FREE and therefore safe for
 * EVERY viewer — anon, pending, expired, approved, admin alike. None of these
 * functions ever selects, counts, or returns a money field.
 *
 * The ONE price-touching helper — `computePriceBands` — is hard-gated behind
 * `canSeePrices(viewer)`: it returns `null` for any viewer who may not see
 * prices, so the UI renders a "log in to filter by price" chip instead of a
 * working band control. A price value therefore never enters an anon payload.
 *
 * Scalability: the catalogue may reach ~10k products, so facets are computed
 * with BOUNDED aggregations (index-backed `groupBy`, band `count`s, and a
 * capped Mongo aggregation for specs) — never by scanning every row into Node.
 */

/* ------------------------------------------------------------------ */
/* Shared visibility filter + scope                                    */
/* ------------------------------------------------------------------ */

/** Only active, non-soft-deleted products participate in facets. */
const VISIBLE_WHERE = {
  status: "ACTIVE",
  deletedAt: null,
} satisfies Prisma.ProductWhereInput;

/**
 * Optional scope narrowing the facet universe — e.g. facets for one category,
 * a brand landing page, or a search result set. All fields are PRICE-FREE.
 * A `search` string is matched case-insensitively across public fields,
 * mirroring the product DAL's `searchWhere`.
 */
export interface FacetScope {
  /** Restrict to a single category. */
  categoryId?: string;
  /** Restrict to a set of brands (by Brand master id). */
  brandIds?: string[];
  /** Free-text search over public fields (name / sku / brand / tags). */
  search?: string;
}

/** Build the case-insensitive AND-of-OR search filter over PUBLIC fields. */
function searchClause(search: string): Prisma.ProductWhereInput | null {
  const q = search.trim();
  if (q.length === 0) return null;
  const terms = q.split(/\s+/).filter(Boolean);
  return {
    AND: terms.map((term) => ({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { sku: { contains: term, mode: "insensitive" } },
        { brand: { contains: term, mode: "insensitive" } },
        { brandRef: { name: { contains: term, mode: "insensitive" } } },
        { tags: { has: term } },
      ],
    })),
  };
}

/** Compose the visibility filter with an optional scope. Never touches price. */
function scopedWhere(scope?: FacetScope): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { ...VISIBLE_WHERE };
  if (scope?.categoryId) {
    where.categoryId = scope.categoryId;
  }
  if (scope?.brandIds && scope.brandIds.length > 0) {
    where.brandId = { in: scope.brandIds };
  }
  if (scope?.search) {
    const clause = searchClause(scope.search);
    if (clause) {
      where.AND = clause.AND;
    }
  }
  return where;
}

/* ------------------------------------------------------------------ */
/* Facet result shapes                                                 */
/* ------------------------------------------------------------------ */

/** One brand bucket: how many visible products reference this brand master. */
export interface BrandFacetBucket {
  brandId: string;
  name: string;
  count: number;
}

/** One stock bucket: how many visible products sit in this stock status. */
export interface StockFacetBucket {
  status: import("@/lib/schemas/shared").StockStatus;
  count: number;
}

/** One tag bucket: how many visible products carry this tag. */
export interface TagFacetBucket {
  tag: string;
  count: number;
}

/** One spec value bucket, e.g. `{ value: "20W", count: 12 }`. */
export interface SpecValueBucket {
  value: string;
  count: number;
}

/** One spec key and its (bounded) top value buckets, e.g. Wattage -> [...]. */
export interface SpecFacet {
  key: string;
  values: SpecValueBucket[];
}

/* ------------------------------------------------------------------ */
/* brandFacet — index-backed groupBy on {brandId}                      */
/* ------------------------------------------------------------------ */

/**
 * Product counts per Brand master, for the current scope. PRICE-FREE.
 *
 * `groupBy` on `brandId` is backed by the `@@index([brandId])`, and brand
 * cardinality is small (dozens), so this is a bounded aggregation — no full
 * scan into Node. Products with no brand (`brandId: null`) are excluded from
 * the facet. Brand names are resolved with a single follow-up `findMany`.
 */
export async function brandFacet(scope?: FacetScope): Promise<BrandFacetBucket[]> {
  const grouped = await prisma.product.groupBy({
    by: ["brandId"],
    where: { ...scopedWhere(scope), brandId: { not: null } },
    _count: { _all: true },
  });

  const ids = grouped
    .map((g) => g.brandId)
    .filter((id): id is string => id !== null);
  if (ids.length === 0) return [];

  const brands = await prisma.brand.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: { id: true, name: true },
  });
  const nameById = new Map(brands.map((b) => [b.id, b.name]));

  return grouped
    .flatMap((g) => {
      if (g.brandId === null) return [];
      const name = nameById.get(g.brandId);
      // Drop brands that are no longer ACTIVE (hidden from the storefront).
      if (name === undefined) return [];
      return [{ brandId: g.brandId, name, count: g._count._all }];
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------------ */
/* stockFacet — index-backed groupBy on {stockStatus}                  */
/* ------------------------------------------------------------------ */

const STOCK_STATUSES = ["IN_STOCK", "LOW", "OUT_OF_STOCK"] as const;

/**
 * Product counts per stock status (3 fixed buckets, always all present so the
 * UI can render zero-count chips). PRICE-FREE, low cardinality, bounded.
 */
export async function stockFacet(scope?: FacetScope): Promise<StockFacetBucket[]> {
  const grouped = await prisma.product.groupBy({
    by: ["stockStatus"],
    where: scopedWhere(scope),
    _count: { _all: true },
  });
  const byStatus = new Map(grouped.map((g) => [g.stockStatus, g._count._all]));
  return STOCK_STATUSES.map((status) => ({
    status,
    count: byStatus.get(status) ?? 0,
  }));
}

/* ------------------------------------------------------------------ */
/* tagFacet — bounded Mongo aggregation over the tags array            */
/* ------------------------------------------------------------------ */

/** Default cap on how many distinct tags a facet returns (top-N by count). */
const TAG_TOP_N = 30;

interface RawCountBucket {
  _id: string;
  count: number;
}

/**
 * Product counts per tag, top-N by frequency. PRICE-FREE.
 *
 * Tags live in a string array, so we push an `$unwind` + `$group` down to
 * MongoDB via `aggregateRaw` and cap the result to the top `limit` tags with
 * `$sort` + `$limit`. Only the tag string and its count are ever emitted — no
 * money field is projected into the pipeline.
 */
export async function tagFacet(
  scope?: FacetScope,
  limit = TAG_TOP_N,
): Promise<TagFacetBucket[]> {
  const match = toRawMatch(scopedWhere(scope));
  const pipeline = [
    { $match: match },
    { $project: { tags: 1 } },
    { $unwind: "$tags" },
    { $group: { _id: "$tags", count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: Math.max(1, Math.trunc(limit)) },
  ] as unknown as Prisma.InputJsonValue[];
  const raw = (await prisma.product.aggregateRaw({
    pipeline,
  })) as unknown as RawCountBucket[];
  return raw
    .filter((b) => typeof b._id === "string" && b._id.length > 0)
    .map((b) => ({ tag: b._id, count: b.count }));
}

/* ------------------------------------------------------------------ */
/* specFacets — bounded Mongo aggregation over the specs object        */
/* ------------------------------------------------------------------ */

/** Defaults bounding the specs aggregation so it stays cheap on 10k rows. */
const SPEC_TOP_KEYS = 8;
const SPEC_TOP_VALUES = 12;

export interface SpecFacetOptions {
  /** Max number of distinct spec keys to return (most common first). */
  maxKeys?: number;
  /** Max number of value buckets per key (most common first). */
  maxValuesPerKey?: number;
}

/**
 * Derives the common spec keys and their value distributions from the free-form
 * `specs` object (a `Record<string,string>`), e.g. `Output -> {20W: 12, 33W: 5}`.
 * PRICE-FREE.
 *
 * `specs` is schemaless JSON, so we cannot `groupBy` it in Prisma. Instead we
 * push a bounded pipeline to MongoDB: `$objectToArray` turns each specs object
 * into `{k, v}` pairs, `$unwind` explodes them, and a single `$group` on
 * `{key, value}` counts occurrences. We then keep only the top `maxKeys` keys
 * (by total product count) and, within each, the top `maxValuesPerKey` values.
 * The whole thing is aggregated inside Mongo — Node only ever receives the
 * bounded, already-summarised bucket rows, never the raw catalogue.
 */
export async function specFacets(
  scope?: FacetScope,
  options?: SpecFacetOptions,
): Promise<SpecFacet[]> {
  const maxKeys = Math.max(1, Math.trunc(options?.maxKeys ?? SPEC_TOP_KEYS));
  const maxValues = Math.max(
    1,
    Math.trunc(options?.maxValuesPerKey ?? SPEC_TOP_VALUES),
  );

  const match = toRawMatch(scopedWhere(scope));
  const pipeline = [
    { $match: match },
    // Keep only the specs field, and only rows where it is an object.
    { $project: { specs: 1 } },
    { $match: { specs: { $type: "object" } } },
    { $project: { kv: { $objectToArray: "$specs" } } },
    { $unwind: "$kv" },
    // Only string-valued specs form facets (numbers/objects are skipped).
    { $match: { "kv.v": { $type: "string" } } },
    {
      $group: {
        _id: { key: "$kv.k", value: "$kv.v" },
        count: { $sum: 1 },
      },
    },
    // Roll each key's values into an array + a key total for key ranking.
    {
      $group: {
        _id: "$_id.key",
        total: { $sum: "$count" },
        values: { $push: { value: "$_id.value", count: "$count" } },
      },
    },
    { $sort: { total: -1, _id: 1 } },
    { $limit: maxKeys },
  ] as unknown as Prisma.InputJsonValue[];

  interface RawSpecGroup {
    _id: string;
    total: number;
    values: { value: string; count: number }[];
  }
  const raw = (await prisma.product.aggregateRaw({
    pipeline,
  })) as unknown as RawSpecGroup[];

  return raw
    .filter((g) => typeof g._id === "string" && g._id.length > 0)
    .map((g) => ({
      key: g._id,
      values: g.values
        .filter((v) => typeof v.value === "string" && v.value.length > 0)
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
        .slice(0, maxValues),
    }));
}

/* ------------------------------------------------------------------ */
/* computePriceBands — THE gated facet                                 */
/* ------------------------------------------------------------------ */

/** Preset price band ids (in rupees), matched to paise ranges internally. */
export type PriceBandId = "0-100" | "100-500" | "500-1000" | "1000+";

/** A price band and how many visible products (in scope) fall within it. */
export interface PriceBandBucket {
  band: PriceBandId;
  /** Inclusive lower bound in paise. */
  minPaise: number;
  /** Exclusive upper bound in paise, or null for the open-ended top band. */
  maxPaise: number | null;
  count: number;
}

/** Band edges in paise (₹1 = 100 paise). Bounds: [min, max). */
const PRICE_BANDS: ReadonlyArray<{
  band: PriceBandId;
  minPaise: number;
  maxPaise: number | null;
}> = [
  { band: "0-100", minPaise: 0, maxPaise: 100_00 },
  { band: "100-500", minPaise: 100_00, maxPaise: 500_00 },
  { band: "500-1000", minPaise: 500_00, maxPaise: 1000_00 },
  { band: "1000+", minPaise: 1000_00, maxPaise: null },
];

/** Resolve the paise range for a band id, or null if the id is unknown. */
export function priceBandRange(
  band: PriceBandId,
): { minPaise: number; maxPaise: number | null } | null {
  const found = PRICE_BANDS.find((b) => b.band === band);
  return found ? { minPaise: found.minPaise, maxPaise: found.maxPaise } : null;
}

/**
 * Preset price-band counts, computed SERVER-SIDE from integer paise — but ONLY
 * for viewers who may see prices. For anon / pending / expired / rejected /
 * blocked viewers this returns `null`, and the UI shows a "log in to filter by
 * price" chip instead of a working band control. A price value therefore never
 * reaches an unauthorised payload.
 *
 * Each band is a single `count` query bounded by a `price` range, so this is 4
 * cheap index-friendly counts — never a scan of prices into Node.
 */
export async function computePriceBands(
  viewer: ViewerContext,
  scope?: FacetScope,
): Promise<PriceBandBucket[] | null> {
  // THE GATE. Non-approved viewers get null — no band data, no prices.
  if (!canSeePrices(viewer)) return null;

  const base = scopedWhere(scope);
  const counts = await Promise.all(
    PRICE_BANDS.map((b) => {
      const price: Prisma.IntFilter = { gte: b.minPaise };
      if (b.maxPaise !== null) price.lt = b.maxPaise;
      return prisma.product.count({ where: { ...base, price } });
    }),
  );

  return PRICE_BANDS.map((b, i) => ({
    band: b.band,
    minPaise: b.minPaise,
    maxPaise: b.maxPaise,
    count: counts[i],
  }));
}

/* ------------------------------------------------------------------ */
/* Raw-match translation helper                                        */
/* ------------------------------------------------------------------ */

/**
 * Translate the (small, PRICE-FREE) Prisma where we build here into the raw
 * MongoDB `$match` document used by the `aggregateRaw` pipelines. We only ever
 * feed it filters we construct in this module (visibility + scope), so the
 * translation is deliberately narrow rather than a general Prisma-to-Mongo
 * compiler. `categoryId` / `brandId` are Mongo `ObjectId`s.
 */
function toRawMatch(where: Prisma.ProductWhereInput): Record<string, unknown> {
  const match: Record<string, unknown> = {
    status: "ACTIVE",
    deletedAt: null,
  };
  if (typeof where.categoryId === "string") {
    match.categoryId = { $oid: where.categoryId };
  }
  const brandId = where.brandId as
    | { in?: string[] }
    | string
    | null
    | undefined;
  if (brandId && typeof brandId === "object" && Array.isArray(brandId.in)) {
    match.brandId = { $in: brandId.in.map((id) => ({ $oid: id })) };
  }
  // Search (`AND` of OR clauses) is intentionally NOT translated for the raw
  // spec/tag pipelines: those facets are scoped by category/brand only. Callers
  // that need search-scoped spec facets pass the search via the DB-level
  // product filters instead. Keeping this narrow avoids a fragile Prisma->Mongo
  // OR translation and never risks leaking price (there is no price here).
  return match;
}
