import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { PAGE_SIZES } from "@/lib/constants";
import {
  canSeePrices,
  type ViewerContext,
} from "@/server/types/viewer";
import {
  toPricedProduct,
  toPublicProduct,
  type PricedProduct,
  type PublicProduct,
  type PricedTaxMapOptions,
  type TaxMapOptions,
} from "@/server/dto/product";
import {
  resolveEffectiveTax,
  resolveVariantEffectiveTax,
  type EffectiveTax,
  type ProfileTaxDefaults,
} from "@/lib/tax-inherit";
import { getSellerTaxProfile } from "@/server/services/tax-profile";
import { assertAdmin } from "./guard";

// ---------------------------------------------------------------------------
// GST threading — resolve the effective tax for each product/variant so the
// mappers can attach the NON-MONETARY public metadata (every viewer) and, for
// priced viewers, the paise breakdown. The seller profile is fetched ONCE per
// request (it is React-`cache()`d). When the GST kill-switch is off we pass
// `null` effective tax everywhere, so every DTO keeps its exact pre-GST shape.
// ---------------------------------------------------------------------------

/**
 * The GST-bearing product fields the resolver reads. All NON-MONETARY (HSN /
 * bps / treatment) so they are safe to select on the gated path too, plus the
 * joined category defaults. A projected list row may omit these entirely — the
 * resolver treats absent fields as "inherit".
 */
interface TaxResolvableRow {
  hsnCode?: string | null;
  gstRateBps?: number | null;
  taxTreatment?: import("@prisma/client").TaxTreatment | null;
  category?: {
    defaultHsnCode?: string | null;
    defaultGstRateBps?: number | null;
  } | null;
  variants?: {
    id: string;
    hsnCode?: string | null;
    gstRateBps?: number | null;
    taxTreatment?: import("@prisma/client").TaxTreatment | null;
  }[];
}

/** Prisma select fragment adding the product's own GST override columns. */
const PRODUCT_TAX_FIELDS = {
  hsnCode: true,
  gstRateBps: true,
  taxTreatment: true,
  category: { select: { defaultHsnCode: true, defaultGstRateBps: true } },
} satisfies Prisma.ProductSelect;

/** Prisma select fragment adding a variant's own GST override columns. */
const VARIANT_TAX_FIELDS = {
  hsnCode: true,
  gstRateBps: true,
  taxTreatment: true,
} satisfies Prisma.ProductVariantSelect;

/**
 * The per-request GST context: the profile-derived backstop plus whether the
 * kill-switch is on. `enabled: false` ⇒ every resolver call returns `null`.
 */
interface TaxContext {
  enabled: boolean;
  profile: ProfileTaxDefaults;
}

/** Loads the per-request tax context from the (cached) seller profile. */
async function loadTaxContext(): Promise<TaxContext> {
  const p = await getSellerTaxProfile();
  return {
    enabled: p.gstEnabled,
    profile: {
      defaultHsnCode: p.defaultHsnCode,
      defaultGstRateBps: p.defaultGstRateBps,
      priceEntryMode: p.priceEntryMode,
    },
  };
}

/**
 * Resolves the effective tax for a product row, or `null` when GST is off.
 * Delegates the precedence chain to {@link resolveEffectiveTax}.
 */
function productEffectiveTax(
  row: TaxResolvableRow,
  ctx: TaxContext,
): EffectiveTax | null {
  if (!ctx.enabled) return null;
  return resolveEffectiveTax({
    entity: {
      hsnCode: row.hsnCode,
      gstRateBps: row.gstRateBps,
      taxTreatment: row.taxTreatment,
    },
    category: row.category ?? null,
    profile: ctx.profile,
  });
}

/**
 * Builds the `TaxMapOptions` for the PUBLIC mapper (product-level metadata only)
 * and, when priced, a per-variant effective-tax resolver keyed by variant id.
 */
function publicTaxOpts(row: TaxResolvableRow, ctx: TaxContext): TaxMapOptions {
  return { effective: productEffectiveTax(row, ctx) };
}

function pricedTaxOpts(
  row: TaxResolvableRow,
  ctx: TaxContext,
): PricedTaxMapOptions {
  const effective = productEffectiveTax(row, ctx);
  if (!ctx.enabled) {
    return { effective: null };
  }
  // Pre-index each variant's resolved effective tax so the mapper can look it
  // up by id (variant → product → category → profile precedence).
  const byId = new Map<string, EffectiveTax>();
  for (const v of row.variants ?? []) {
    byId.set(
      v.id,
      resolveVariantEffectiveTax({
        variant: {
          hsnCode: v.hsnCode,
          gstRateBps: v.gstRateBps,
          taxTreatment: v.taxTreatment,
        },
        product: {
          hsnCode: row.hsnCode,
          gstRateBps: row.gstRateBps,
          taxTreatment: row.taxTreatment,
        },
        category: row.category ?? null,
        profile: ctx.profile,
      }),
    );
  }
  return {
    effective,
    variantEffective: (variantId) => byId.get(variantId) ?? effective,
  };
}

/**
 * Viewer-aware product Data Access Layer — the read half of the price gate.
 *
 * Every storefront read takes a `ViewerContext` and returns `PublicProduct[]`
 * (no money fields) UNLESS `canSeePrices(viewer)` is true, in which case it
 * returns `PricedProduct[]`. For non-priced viewers we hand Mongo a `select`
 * projection that OMITS `price` and `mrp`, so the price never travels over the
 * wire into the Node process — defence in depth beyond the DTO mapper.
 *
 * TypeScript overloads narrow the return type on the concrete viewer kind at
 * the callsite where it is statically known (admin → priced), and fall back to
 * the union for a dynamic `ViewerContext`.
 */

/** Fields shared by both projections — everything except money. */
const PUBLIC_FIELDS = {
  id: true,
  categoryId: true,
  name: true,
  slug: true,
  sku: true,
  brand: true,
  // Brand master join — PUBLIC fields only (id/name/slug). Adds NO price to
  // the payload, so this is safe for every viewer including anon.
  brandRef: { select: { id: true, name: true, slug: true } },
  description: true,
  specs: true,
  moq: true,
  stockStatus: true,
  status: true,
  tags: true,
  images: true,
  createdAt: true,
  updatedAt: true,
  // GST override columns + category defaults. NON-MONETARY (HSN / bps /
  // treatment) — safe for the gated path; they feed the effective-tax resolver
  // that produces the amount-free public "incl./+ X% GST" metadata.
  ...PRODUCT_TAX_FIELDS,
} satisfies Prisma.ProductSelect;

/** Projection with money — only ever used for price-authorised viewers. */
const PRICED_SELECT = {
  ...PUBLIC_FIELDS,
  price: true,
  mrp: true,
} satisfies Prisma.ProductSelect;

// ---------------------------------------------------------------------------
// Variant projections — only fetched on the DETAIL path (getBySlugForViewer).
// Listing/grid reads deliberately DO NOT join variants: they show the
// denormalized `Product.price` ("from" price, already gated) so sort/paging is
// unchanged and no variant price is ever selected into a list payload.
// ---------------------------------------------------------------------------

/** Only ACTIVE variants are shown on the storefront, ordered deterministically. */
const VARIANT_WHERE = { status: "ACTIVE" } satisfies Prisma.ProductVariantWhereInput;
const VARIANT_ORDER: Prisma.ProductVariantOrderByWithRelationInput[] = [
  { isDefault: "desc" },
  { sortOrder: "asc" },
  { id: "asc" },
];

/**
 * Variant fields shared by both projections — everything EXCEPT money. For a
 * gated viewer this is the ONLY variant select used, so no variant price/mrp
 * ever travels into Node. `optionTypes` is a scalar on Product (public).
 */
const PUBLIC_VARIANT_SELECT = {
  id: true,
  sku: true,
  optionValues: true,
  stockStatus: true,
  isDefault: true,
  sortOrder: true,
  images: true,
  // NON-MONETARY GST override columns — safe on the gated path (see above).
  ...VARIANT_TAX_FIELDS,
} satisfies Prisma.ProductVariantSelect;

/** Variant projection WITH money — only for price-authorised viewers. */
const PRICED_VARIANT_SELECT = {
  ...PUBLIC_VARIANT_SELECT,
  price: true,
  mrp: true,
} satisfies Prisma.ProductVariantSelect;

/** Detail-path select for gated viewers: product public fields + gated variants. */
const PUBLIC_DETAIL_SELECT = {
  ...PUBLIC_FIELDS,
  hasVariants: true,
  optionTypes: true,
  variants: { where: VARIANT_WHERE, orderBy: VARIANT_ORDER, select: PUBLIC_VARIANT_SELECT },
} satisfies Prisma.ProductSelect;

/** Detail-path select for priced viewers: product money + variant money. */
const PRICED_DETAIL_SELECT = {
  ...PRICED_SELECT,
  hasVariants: true,
  optionTypes: true,
  variants: { where: VARIANT_WHERE, orderBy: VARIANT_ORDER, select: PRICED_VARIANT_SELECT },
} satisfies Prisma.ProductSelect;

/** Only active, non-soft-deleted products are visible on the storefront. */
const VISIBLE_WHERE = {
  status: "ACTIVE",
  deletedAt: null,
} satisfies Prisma.ProductWhereInput;

/** Deterministic storefront ordering: newest first, stable by id. */
const STOREFRONT_ORDER: Prisma.ProductOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "asc" },
];

export interface ListForViewerOptions {
  /** 1-based page number. Defaults to 1. */
  page?: number;
  /** Page size; clamped to [1, PAGE_SIZES.max]. Defaults to storefront size. */
  take?: number;
}

function resolvePaging(options: ListForViewerOptions | undefined): {
  skip: number;
  take: number;
} {
  const page = Math.max(1, Math.trunc(options?.page ?? 1));
  const requested = Math.trunc(options?.take ?? PAGE_SIZES.storefront);
  const take = Math.min(PAGE_SIZES.max, Math.max(1, requested));
  return { skip: (page - 1) * take, take };
}

// ---------------------------------------------------------------------------
// listForViewer
// ---------------------------------------------------------------------------

export function listForViewer(
  viewer: import("@/server/types/viewer").AdminViewer,
  options?: ListForViewerOptions,
): Promise<PricedProduct[]>;
export function listForViewer(
  viewer: import("@/server/types/viewer").AnonViewer,
  options?: ListForViewerOptions,
): Promise<PublicProduct[]>;
export function listForViewer(
  viewer: ViewerContext,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]>;
export async function listForViewer(
  viewer: ViewerContext,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]> {
  const { skip, take } = resolvePaging(options);
  const ctx = await loadTaxContext();
  if (canSeePrices(viewer)) {
    const rows = await prisma.product.findMany({
      where: VISIBLE_WHERE,
      select: PRICED_SELECT,
      orderBy: STOREFRONT_ORDER,
      skip,
      take,
    });
    return rows.map((row) => toPricedProduct(row, pricedTaxOpts(row, ctx)));
  }
  const rows = await prisma.product.findMany({
    where: VISIBLE_WHERE,
    select: PUBLIC_FIELDS,
    orderBy: STOREFRONT_ORDER,
    skip,
    take,
  });
  return rows.map((row) => toPublicProduct(row, publicTaxOpts(row, ctx)));
}

// ---------------------------------------------------------------------------
// getBySlugForViewer
// ---------------------------------------------------------------------------

export function getBySlugForViewer(
  viewer: import("@/server/types/viewer").AdminViewer,
  slug: string,
): Promise<PricedProduct | null>;
export function getBySlugForViewer(
  viewer: import("@/server/types/viewer").AnonViewer,
  slug: string,
): Promise<PublicProduct | null>;
export function getBySlugForViewer(
  viewer: ViewerContext,
  slug: string,
): Promise<PublicProduct | PricedProduct | null>;
export async function getBySlugForViewer(
  viewer: ViewerContext,
  slug: string,
): Promise<PublicProduct | PricedProduct | null> {
  const ctx = await loadTaxContext();
  if (canSeePrices(viewer)) {
    const row = await prisma.product.findFirst({
      where: { ...VISIBLE_WHERE, slug },
      select: PRICED_DETAIL_SELECT,
    });
    return row ? toPricedProduct(row, pricedTaxOpts(row, ctx)) : null;
  }
  const row = await prisma.product.findFirst({
    where: { ...VISIBLE_WHERE, slug },
    select: PUBLIC_DETAIL_SELECT,
  });
  return row ? toPublicProduct(row, publicTaxOpts(row, ctx)) : null;
}

// ---------------------------------------------------------------------------
// listByCategoryForViewer
// ---------------------------------------------------------------------------

export function listByCategoryForViewer(
  viewer: import("@/server/types/viewer").AdminViewer,
  categoryId: string,
  options?: ListForViewerOptions,
): Promise<PricedProduct[]>;
export function listByCategoryForViewer(
  viewer: import("@/server/types/viewer").AnonViewer,
  categoryId: string,
  options?: ListForViewerOptions,
): Promise<PublicProduct[]>;
export function listByCategoryForViewer(
  viewer: ViewerContext,
  categoryId: string,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]>;
export async function listByCategoryForViewer(
  viewer: ViewerContext,
  categoryId: string,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]> {
  const { skip, take } = resolvePaging(options);
  const where = { ...VISIBLE_WHERE, categoryId } satisfies Prisma.ProductWhereInput;
  const ctx = await loadTaxContext();
  if (canSeePrices(viewer)) {
    const rows = await prisma.product.findMany({
      where,
      select: PRICED_SELECT,
      orderBy: STOREFRONT_ORDER,
      skip,
      take,
    });
    return rows.map((row) => toPricedProduct(row, pricedTaxOpts(row, ctx)));
  }
  const rows = await prisma.product.findMany({
    where,
    select: PUBLIC_FIELDS,
    orderBy: STOREFRONT_ORDER,
    skip,
    take,
  });
  return rows.map((row) => toPublicProduct(row, publicTaxOpts(row, ctx)));
}

// ---------------------------------------------------------------------------
// searchForViewer — text search pushed down to the database.
// ---------------------------------------------------------------------------

/**
 * Build the case-insensitive OR filter for a search over PUBLIC fields only
 * (name / sku / brand / tags). Never touches money, so it is safe for every
 * viewer. Empty / whitespace queries yield an empty filter (no OR).
 */
function searchWhere(query: string): Prisma.ProductWhereInput {
  const q = query.trim();
  if (q.length === 0) return VISIBLE_WHERE;
  const terms = q.split(/\s+/).filter(Boolean);
  // AND across terms, each term matching any public field (OR across fields).
  const and: Prisma.ProductWhereInput[] = terms.map((term) => ({
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      { sku: { contains: term, mode: "insensitive" } },
      { brand: { contains: term, mode: "insensitive" } },
      { brandRef: { name: { contains: term, mode: "insensitive" } } },
      { tags: { has: term } },
    ],
  }));
  return { ...VISIBLE_WHERE, AND: and };
}

export function searchForViewer(
  viewer: import("@/server/types/viewer").AdminViewer,
  query: string,
  options?: ListForViewerOptions,
): Promise<PricedProduct[]>;
export function searchForViewer(
  viewer: import("@/server/types/viewer").AnonViewer,
  query: string,
  options?: ListForViewerOptions,
): Promise<PublicProduct[]>;
export function searchForViewer(
  viewer: ViewerContext,
  query: string,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]>;
export async function searchForViewer(
  viewer: ViewerContext,
  query: string,
  options?: ListForViewerOptions,
): Promise<(PublicProduct | PricedProduct)[]> {
  const { skip, take } = resolvePaging(options);
  const where = searchWhere(query);
  const ctx = await loadTaxContext();
  if (canSeePrices(viewer)) {
    const rows = await prisma.product.findMany({
      where,
      select: PRICED_SELECT,
      orderBy: STOREFRONT_ORDER,
      skip,
      take,
    });
    return rows.map((row) => toPricedProduct(row, pricedTaxOpts(row, ctx)));
  }
  const rows = await prisma.product.findMany({
    where,
    select: PUBLIC_FIELDS,
    orderBy: STOREFRONT_ORDER,
    skip,
    take,
  });
  return rows.map((row) => toPublicProduct(row, publicTaxOpts(row, ctx)));
}

/** Count products matching a search query (for pagination / result counts). */
export async function countSearchForViewer(query: string): Promise<number> {
  return prisma.product.count({ where: searchWhere(query) });
}

// ---------------------------------------------------------------------------
// listForAdminGrid — admin-only, always priced, includes soft-deleted &
// inactive rows for the DealSheet management view.
// ---------------------------------------------------------------------------

export interface AdminGridOptions extends ListForViewerOptions {
  /** Include soft-deleted rows (deletedAt != null). Defaults to false. */
  includeDeleted?: boolean;
  /**
   * Load the ENTIRE catalog in one read (no pagination). The DealSheet is a
   * client-side spreadsheet: its search / column filters / sort operate over
   * the rows it holds, so to make "filter over the whole DB, not just the
   * visible page" true, every product must be present. The grid is virtualized,
   * so rendering thousands of rows is cheap. Defaults to false (paged).
   */
  all?: boolean;
}

/**
 * A priced product PLUS a lightweight active-variant count for the bulk-edit
 * grid. We deliberately do NOT join the full variant rows here (a list read
 * must not carry per-variant money or drag in N child rows per product); a
 * Prisma `_count` gives the grid exactly what it needs to render the read-only
 * "from ₹X · N variants" indicator and to gate price/mrp/stock edits.
 */
export interface AdminGridProduct extends PricedProduct {
  /** Number of ACTIVE variants (0 when `hasVariants` is false). */
  variantCount: number;
  /**
   * The product's OWN GST overrides (raw stored values, not the resolved
   * effective tax). NON-MONETARY. `null` means "inherit" (category → profile).
   * The bulk-edit grid renders/edits these directly; they are absent from the
   * gated DTO by design, so the grid (admin-only, priced) reads them here.
   */
  hsnCode: string | null;
  gstRateBps: number | null;
  taxTreatment: import("@prisma/client").TaxTreatment | null;
}

/**
 * Grid select: priced product fields + `hasVariants` + a scalar count of ACTIVE
 * variants. No variant row (and therefore no variant price) is selected.
 */
const ADMIN_GRID_SELECT = {
  ...PRICED_SELECT,
  hasVariants: true,
  _count: { select: { variants: { where: VARIANT_WHERE } } },
} satisfies Prisma.ProductSelect;

/**
 * The full management grid: prices always present, and (unlike the storefront
 * reads) INACTIVE products are included. Throws `ForbiddenError` for any
 * non-admin viewer before touching the database.
 */
export async function listForAdminGrid(
  viewer: ViewerContext,
  options?: AdminGridOptions,
): Promise<AdminGridProduct[]> {
  assertAdmin(viewer);
  // `all` bypasses paging entirely so the client grid holds every product and
  // its filters/search cover the whole DB, not just one page.
  const paging = options?.all ? {} : resolvePaging(options);
  const where: Prisma.ProductWhereInput = options?.includeDeleted
    ? {}
    : { deletedAt: null };
  const ctx = await loadTaxContext();
  const rows = await prisma.product.findMany({
    where,
    select: ADMIN_GRID_SELECT,
    orderBy: STOREFRONT_ORDER,
    ...paging,
  });
  // Map WITHOUT the variant rows (none selected) — `toPricedProduct` yields
  // `variants: []`; we layer the real active count on top from `_count`.
  return rows.map((row) => ({
    ...toPricedProduct(row, pricedTaxOpts(row, ctx)),
    variantCount: row._count.variants,
    // Raw override columns for the editable grid cells (inherit vs. pinned).
    hsnCode: row.hsnCode ?? null,
    gstRateBps: row.gstRateBps ?? null,
    taxTreatment: row.taxTreatment ?? null,
  }));
}
