import "server-only";

import { formatPaise } from "@/lib/money";
import type { ViewerContext } from "@/server/types/viewer";
import {
  brandFacet,
  computePriceBands,
  specFacets,
  stockFacet,
  tagFacet,
  type BrandFacetBucket,
  type FacetScope,
  type PriceBandBucket,
  type SpecFacet as DalSpecFacet,
  type StockFacetBucket,
  type TagFacetBucket,
} from "@/server/dal/facets";
import type {
  DiscoverParams,
  DiscoverSort,
  SpecFilter,
} from "@/server/storefront/discovery";
import type {
  FacetData,
  FacetSelection,
  PriceBandFacet,
  SpecFacetGroup,
} from "./types";

/**
 * Server-side adapter between the facet DAL (`src/server/dal/facets.ts`) +
 * discovery orchestrator (`src/server/storefront/discovery.ts`) and the client
 * facet UI's {@link FacetData} / {@link FacetSelection} contract.
 *
 * This is the single translation seam, kept on the SERVER so the price gate is
 * respected in one place:
 *   - {@link buildFacetData} maps the DAL's price-free brand/spec/stock/tag
 *     buckets into the UI shape, and folds the gated price-band buckets into a
 *     discriminated `priceBands` value. `priceBandBuckets` is `null` for any
 *     viewer who may not see prices (the DAL's `computePriceBands` returns
 *     null), which we surface as `{ approved: false }` — NO band, count, or
 *     amount reaches the client.
 *   - {@link selectionToDiscoverParams} maps a URL-parsed selection back into
 *     the orchestrator's params. The `band` is only ever forwarded for an
 *     approved viewer (double-gated: the discovery layer also ignores it).
 *
 * Because band labels are formatted from paise HERE, and only ever from the
 * already-authorised `PriceBandBucket[]` (non-null = approved), no price string
 * is ever produced for a gated viewer.
 */

/**
 * Human-friendly, pre-formatted range label for a price band. Formatted from
 * integer paise; only ever called with buckets the server computed for an
 * approved viewer.
 */
function bandLabel(bucket: PriceBandBucket): string {
  const min = formatPaise(bucket.minPaise, { compact: true });
  if (bucket.maxPaise === null) {
    return `${min} & above`;
  }
  // Upper bound is exclusive; show it as an inclusive-feeling range.
  const max = formatPaise(bucket.maxPaise, { compact: true });
  if (bucket.minPaise === 0) {
    return `Under ${max}`;
  }
  return `${min} – ${max}`;
}

export interface BuildFacetDataInput {
  brands: BrandFacetBucket[];
  specs: DalSpecFacet[];
  stock: StockFacetBucket[];
  tags: TagFacetBucket[];
  /** Gated: `null` for viewers who may not see prices. */
  priceBandBuckets: PriceBandBucket[] | null;
}

/** Convert a spec key into a display label ("screen_size" -> "Screen size"). */
function humanizeSpecKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  if (spaced.length === 0) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Assemble the client-facing {@link FacetData} from the DAL's raw buckets.
 * PRICE GATE: `priceBandBuckets === null` (gated viewer) yields
 * `priceBands: { approved: false }` — no band data crosses to the client.
 */
export function buildFacetData(input: BuildFacetDataInput): FacetData {
  const priceBands: PriceBandFacet =
    input.priceBandBuckets === null
      ? { approved: false }
      : {
          approved: true,
          bands: input.priceBandBuckets.map((b) => ({
            value: b.band,
            label: bandLabel(b),
            count: b.count,
          })),
        };

  const specGroups: SpecFacetGroup[] = input.specs.map((spec) => ({
    key: spec.key,
    label: humanizeSpecKey(spec.key),
    buckets: spec.values.map((v) => ({
      value: v.value,
      label: v.value,
      count: v.count,
    })),
  }));

  return {
    brand: {
      buckets: input.brands.map((b) => ({
        // URL value is the Brand master id (discovery filters by brandIds).
        value: b.brandId,
        label: b.name,
        count: b.count,
      })),
    },
    specs: { groups: specGroups },
    stock: {
      buckets: input.stock.map((s) => ({
        value: s.status,
        label: s.status,
        count: s.count,
      })),
    },
    tags: {
      buckets: input.tags.map((t) => ({
        value: t.tag,
        label: t.tag,
        count: t.count,
      })),
    },
    priceBands,
  };
}

/**
 * Fan out every facet aggregation for a scope + viewer and assemble the
 * client-facing {@link FacetData}. Runs the price-free brand/spec/stock/tag
 * facets in parallel with the GATED price-band computation — the latter returns
 * `null` for a non-approved viewer, which {@link buildFacetData} surfaces as
 * `{ approved: false }` so no band ever reaches the client.
 *
 * Every underlying query is a bounded aggregation (index-backed groupBy, capped
 * Mongo pipelines, 4 range counts) — never a full-catalogue scan into Node.
 */
export async function loadFacetData(
  viewer: ViewerContext,
  scope?: FacetScope,
): Promise<FacetData> {
  const [brands, specs, stock, tags, priceBandBuckets] = await Promise.all([
    brandFacet(scope),
    specFacets(scope),
    stockFacet(scope),
    tagFacet(scope),
    computePriceBands(viewer, scope),
  ]);
  return buildFacetData({ brands, specs, stock, tags, priceBandBuckets });
}

/** All valid preset band ids (mirrors the DAL's `PriceBandId`). */
const PRICE_BAND_IDS = ["0-100", "100-500", "500-1000", "1000+"] as const;
type PriceBandId = (typeof PRICE_BAND_IDS)[number];

function toPriceBandId(value: string | null): PriceBandId | undefined {
  if (value && (PRICE_BAND_IDS as readonly string[]).includes(value)) {
    return value as PriceBandId;
  }
  return undefined;
}

/** Map the listing sort key to the discovery orchestrator's sort. */
export function toDiscoverSort(
  sort: string | null | undefined,
): DiscoverSort | undefined {
  switch (sort) {
    case "name":
      return "name-asc";
    case "price-asc":
      return "price-asc";
    case "price-desc":
      return "price-desc";
    case "newest":
      return "newest";
    default:
      return undefined;
  }
}

export interface SelectionToParamsOptions {
  approved: boolean;
  categoryId?: string;
  search?: string;
  sort?: DiscoverSort;
  cursor?: string;
  limit?: number;
}

/**
 * Convert a URL-parsed {@link FacetSelection} into discovery {@link
 * DiscoverParams}. The price band is forwarded ONLY for approved viewers — for
 * anyone else it is dropped here (and the discovery layer would ignore it
 * anyway), so a gated selection can never influence the query by price.
 */
export function selectionToDiscoverParams(
  selection: FacetSelection,
  options: SelectionToParamsOptions,
): DiscoverParams {
  const specFilters: SpecFilter[] = Object.entries(selection.specs)
    .filter(([, values]) => values.length > 0)
    .map(([key, values]) => ({ key, values }));

  const params: DiscoverParams = {
    categoryId: options.categoryId,
    brandIds: selection.brands.length > 0 ? selection.brands : undefined,
    specFilters: specFilters.length > 0 ? specFilters : undefined,
    stock: selection.stock.length > 0 ? selection.stock : undefined,
    tags: selection.tags.length > 0 ? selection.tags : undefined,
    search: options.search,
    sort: options.sort,
    cursor: options.cursor,
    limit: options.limit,
  };

  // THE GATE: only an approved viewer's band selection reaches the query.
  if (options.approved) {
    const band = toPriceBandId(selection.band);
    if (band) params.priceBand = band;
  }

  return params;
}
