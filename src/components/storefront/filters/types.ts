import type { StockStatus } from "@/lib/schemas/shared";

/**
 * Discovery facet contract (PRD 7.7).
 *
 * This module is the SHARED interface between the server facet DAL
 * (`src/server/dal/facets.ts`, owned by the discovery-server task) and the
 * client facet UI in this folder. The DAL AGGREGATES bounded facet counts
 * (never a full 10k-row scan) and hands the client this structurally
 * price-free payload.
 *
 * THE PRICE GATE. Nothing in a {@link FacetData} payload carries a money
 * amount for a gated viewer. The brand / spec / stock / tag facets are
 * price-free for everyone. The PRICE facet is special:
 *
 *   - For an APPROVED viewer the server sets `priceBands.approved = true` and
 *     supplies band buckets WITH counts (the counts are aggregated server-side
 *     over already-visible products; a viewer who may sort/filter by price can
 *     already see every price, so a count does not widen the gate).
 *   - For anon / pending / expired the server sets `priceBands.approved =
 *     false` and supplies NO bands. The UI then renders a "Log in to filter by
 *     price" chip — NEVER a working slider — so no amount, band, or count ever
 *     reaches a gated client.
 *
 * All facet SELECTIONS live in the URL (`brand`, `spec.<key>`, `stock`, `tag`,
 * `band`) so filtered views are shareable and SSR-friendly.
 */

/** A single selectable value in a facet, with its bounded result count. */
export interface FacetBucket {
  /** Stable value used in the URL / query (e.g. brand slug, spec value). */
  value: string;
  /** Human label shown in the UI (e.g. brand name). Defaults to `value`. */
  label: string;
  /** Number of matching products (aggregated server-side; bounded). */
  count: number;
}

/** Brand facet — multi-select checklist keyed by brand slug. */
export interface BrandFacet {
  buckets: FacetBucket[];
}

/** One collapsible spec group (e.g. "Capacity") with its value buckets. */
export interface SpecFacetGroup {
  /** Stable spec key used in the URL param `spec.<key>` (e.g. "capacity"). */
  key: string;
  /** Display label for the group (e.g. "Capacity"). */
  label: string;
  buckets: FacetBucket[];
}

/** Spec facet — zero or more collapsible groups, each multi-select. */
export interface SpecFacet {
  groups: SpecFacetGroup[];
}

/** Stock facet — a bucket per stock status, with counts. */
export interface StockFacet {
  buckets: Array<FacetBucket & { value: StockStatus }>;
}

/** Tag facet — multi-select checklist of catalogue tags. */
export interface TagFacet {
  buckets: FacetBucket[];
}

/**
 * Price-band facet. This is the ONLY gated facet.
 *
 * When `approved` is false the payload carries NO bands — the discriminated
 * union makes it a TYPE ERROR to read `bands` without first checking
 * `approved`, so a gated code path can never accidentally surface a price
 * band or count.
 */
export type PriceBandFacet =
  | {
      approved: true;
      /** Price bands WITH counts — approved viewers only. */
      bands: PriceBand[];
    }
  | {
      approved: false;
    };

/**
 * A price band bucket. `value` is an opaque band id (e.g. "0-50000") used in
 * the URL `band` param; `label` is the pre-formatted, server-rendered range
 * string (e.g. "Under ₹500") so the client never formats — or even sees — a
 * raw amount beyond the already-authorised band boundaries.
 */
export interface PriceBand {
  value: string;
  label: string;
  count: number;
}

/**
 * The complete facet payload for a listing surface and the current viewer.
 * Assembled by the server facet DAL from bounded aggregations.
 */
export interface FacetData {
  brand: BrandFacet;
  specs: SpecFacet;
  stock: StockFacet;
  tags: TagFacet;
  priceBands: PriceBandFacet;
}

/* ------------------------------------------------------------------ */
/* Active-selection model (URL <-> state)                             */
/* ------------------------------------------------------------------ */

/**
 * The parsed, in-memory representation of every active facet selection.
 * Mirrors the URL params one-to-one so the panel is fully shareable and can
 * be reconstructed on the server for SSR.
 */
export interface FacetSelection {
  /** Selected brand slugs. */
  brands: string[];
  /** Selected spec values, keyed by spec key. */
  specs: Record<string, string[]>;
  /** Selected stock statuses. */
  stock: StockStatus[];
  /** Selected tags. */
  tags: string[];
  /** Selected price-band id — ONLY meaningful for approved viewers. */
  band: string | null;
}

/** An empty selection (no facet applied). */
export const EMPTY_SELECTION: FacetSelection = {
  brands: [],
  specs: {},
  stock: [],
  tags: [],
  band: null,
};

/** URL param names for each facet (single source of truth). */
export const FACET_PARAMS = {
  brand: "brand",
  stock: "stock",
  tag: "tag",
  band: "band",
  /** Spec params are namespaced: `spec.<key>`. */
  specPrefix: "spec.",
} as const;

const STOCK_VALUES: readonly StockStatus[] = [
  "IN_STOCK",
  "LOW",
  "OUT_OF_STOCK",
] as const;

function isStockStatus(value: string): value is StockStatus {
  return (STOCK_VALUES as readonly string[]).includes(value);
}

/**
 * Parse a {@link FacetSelection} out of URLSearchParams. Multi-value facets
 * accept repeated params OR a single comma-joined value (both are produced by
 * the writer below and by hand-shared links). Spec params are read from every
 * `spec.<key>` entry. The `band` param is IGNORED unless `approved` is true,
 * so a shared link from an approved user cannot leak a price band into a gated
 * viewer's state.
 */
export function parseSelection(
  params: URLSearchParams,
  approved: boolean,
): FacetSelection {
  const multi = (key: string): string[] => {
    const out: string[] = [];
    for (const raw of params.getAll(key)) {
      for (const part of raw.split(",")) {
        const v = part.trim();
        if (v) out.push(v);
      }
    }
    return Array.from(new Set(out));
  };

  const specs: Record<string, string[]> = {};
  for (const [key, raw] of params.entries()) {
    if (!key.startsWith(FACET_PARAMS.specPrefix)) continue;
    const specKey = key.slice(FACET_PARAMS.specPrefix.length);
    if (!specKey) continue;
    const values = raw
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length === 0) continue;
    const existing = specs[specKey] ?? [];
    specs[specKey] = Array.from(new Set([...existing, ...values]));
  }

  const stock = multi(FACET_PARAMS.stock).filter(isStockStatus);

  return {
    brands: multi(FACET_PARAMS.brand),
    specs,
    stock,
    tags: multi(FACET_PARAMS.tag),
    // NEVER honour a band for a gated viewer.
    band: approved ? params.get(FACET_PARAMS.band) : null,
  };
}

/**
 * Write a {@link FacetSelection} back onto an existing URLSearchParams,
 * preserving unrelated params (view / sort / q / stock listing filter live
 * elsewhere). Uses comma-joined values for compact, shareable URLs, and
 * REMOVES any `band` param for a non-approved viewer so a gated URL can never
 * carry a price band.
 */
export function writeSelection(
  base: URLSearchParams,
  selection: FacetSelection,
  approved: boolean,
): URLSearchParams {
  const params = new URLSearchParams(base.toString());

  // Clear all facet params first (including stale spec.* keys).
  for (const key of Array.from(params.keys())) {
    if (
      key === FACET_PARAMS.brand ||
      key === FACET_PARAMS.stock ||
      key === FACET_PARAMS.tag ||
      key === FACET_PARAMS.band ||
      key.startsWith(FACET_PARAMS.specPrefix)
    ) {
      params.delete(key);
    }
  }

  const setMulti = (key: string, values: string[]) => {
    const clean = Array.from(new Set(values.filter(Boolean)));
    if (clean.length > 0) params.set(key, clean.join(","));
  };

  setMulti(FACET_PARAMS.brand, selection.brands);
  setMulti(FACET_PARAMS.stock, selection.stock);
  setMulti(FACET_PARAMS.tag, selection.tags);
  for (const [key, values] of Object.entries(selection.specs)) {
    setMulti(`${FACET_PARAMS.specPrefix}${key}`, values);
  }
  if (approved && selection.band) {
    params.set(FACET_PARAMS.band, selection.band);
  }

  return params;
}

/** Total number of active facet selections (for the "clear all" badge). */
export function countSelection(selection: FacetSelection): number {
  let n = selection.brands.length + selection.stock.length + selection.tags.length;
  for (const values of Object.values(selection.specs)) n += values.length;
  if (selection.band) n += 1;
  return n;
}
