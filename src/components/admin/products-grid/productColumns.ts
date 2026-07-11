/**
 * Product column configuration for the DealSheet bulk-edit grid.
 *
 * This is the ENTIRE domain surface of the grid: the engine in
 * `@/components/grid` is generic and hardcodes no product fields. Everything
 * product-specific — which columns exist, how they render, what they accept —
 * lives here as a `ColumnDef<ProductRow>[]`.
 *
 * Money is integer paise throughout. The `currency` editor parses human rupee
 * input back to paise before it ever reaches `validate` or the `onSave` patch,
 * so both the validators and the persistence adapter operate purely in paise —
 * exactly what `saveProductField` (which re-validates via the product zod
 * schema) expects.
 *
 * Each editable column carries a `validate` derived from the same zod field
 * definitions used server-side (`@/lib/schemas/product`), so the grid rejects
 * bad values inline before a round-trip, and the server rejects them again as
 * defence in depth.
 */

import type { ColumnDef, GridRow } from "@/components/grid/types";
import type { CategoryDTO } from "@/server/dal/categories";
import type { BrandOption } from "@/server/services/brands";
import { formatPaise } from "@/lib/money";
import {
  updateProductSchema,
  type UpdateProductInput,
} from "@/lib/schemas/product";
import type { EntityStatus, StockStatus } from "@/lib/schemas/shared";
import {
  VARIANT_MANAGED_MESSAGE,
  variantSummaryLabel,
} from "./VariantCell";

/* -------------------------------------------------------------------------- */
/*  Row shape                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The concrete row projected into the grid. Keys are type-checked against the
 * column `key`s below. `updatedAt` (epoch ms) enables the engine's stale-write
 * conflict detection; `images` count feeds the read-only image summary cell.
 */
export interface ProductRow extends GridRow {
  id: string;
  name: string;
  sku: string;
  /**
   * Legacy free-text brand name, kept read-through for display/back-compat. The
   * editable grid column is now `brandId` (a Brand-master select). INTEGRATOR:
   * `toProductRow` should also set `brandId` from `product.brandRef?.id ?? null`
   * so the select shows the current brand.
   */
  brand: string | null;
  /** Reference to the Brand master — value behind the brand `select` column. */
  brandId?: string | null;
  categoryId: string;
  price: number; // paise
  mrp: number | null; // paise
  stockStatus: StockStatus;
  status: EntityStatus;
  tags: string[];
  /** Count of attached images — rendered read-only, click opens the editor. */
  images: number;
  /**
   * Whether this product is split into purchasable variants. When true, the
   * top-level `price` / `mrp` / `stockStatus` are RECOMPUTED "FROM" values
   * owned by the variant matrix — the grid renders them read-only and refuses
   * to persist edits to them (see `ProductGrid`'s `onSave` guard). Non-variant
   * rows (the vast majority) behave EXACTLY as before: fully editable.
   *
   * INTEGRATOR: the server page that builds rows must thread this through
   * `toProductRow(product)` — it reads `PricedProduct.hasVariants`.
   */
  hasVariants: boolean;
  /**
   * Number of variants for this product (0 when `hasVariants` is false). Feeds
   * the read-only "Variants" info column's "N variants" summary. INTEGRATOR:
   * `toProductRow` derives this from `PricedProduct.variants.length`.
   */
  variantCount: number;
  /** Derived margin string; never persisted, produced by the computed column. */
  margin?: string;
  /** Read-only variant summary ("from ₹X · N variants"); computed, never sent. */
  variantSummary?: string;
  /** Epoch ms of the last persisted write, for conflict detection. */
  updatedAt?: number;
}

/* -------------------------------------------------------------------------- */
/*  Variant read-only guard                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Guard a validator for a variant-managed field (price / mrp / stock). On a
 * variant row the recompute owns the value, so any candidate edit is rejected
 * inline with the canonical message — the engine surfaces it as the cell's
 * red-corner tooltip. On a plain product row the field validates exactly as
 * before via `base`. This blocks the interactive edit path; the airtight
 * persistence guard (covering paste/fill, which bypass `validate`) lives in
 * `ProductGrid.onSave`.
 */
function guardVariantManaged(
  base: (value: unknown, row: ProductRow) => string | null,
): (value: unknown, row: ProductRow) => string | null {
  return (value, row) =>
    row.hasVariants ? VARIANT_MANAGED_MESSAGE : base(value, row);
}

/* -------------------------------------------------------------------------- */
/*  Static option sets                                                        */
/* -------------------------------------------------------------------------- */

const STOCK_OPTIONS = [
  { value: "IN_STOCK", label: "In stock", color: "success" },
  { value: "LOW", label: "Low", color: "warning" },
  { value: "OUT_OF_STOCK", label: "Out of stock", color: "destructive" },
] as const;

/**
 * Rotating palette of semantic chip tokens for category coloring. Categories
 * are dynamic, so we deterministically assign each a color by its index — the
 * same category always gets the same chip within a render.
 */
const CATEGORY_PALETTE = [
  "primary",
  "accent",
  "success",
  "warning",
  "destructive",
  "muted",
] as const;

/* -------------------------------------------------------------------------- */
/*  zod-backed validators                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Validate a candidate patch against the exact server-side update schema and
 * return the first error message for `field`, or null when valid. Running the
 * real `updateProductSchema` (rather than a re-derived per-field copy) keeps
 * the grid's inline validation byte-for-byte identical to what
 * `saveProductField` enforces on commit — including cross-field refinements
 * when the patch carries more than one key (e.g. mrp vs. price).
 */
function validatePatch(
  patch: Partial<UpdateProductInput>,
  field: keyof UpdateProductInput,
): string | null {
  const result = updateProductSchema.safeParse(patch);
  if (result.success) return null;
  // Prefer an issue that targets this field; fall back to the first issue.
  const forField = result.error.issues.find((issue) => issue.path[0] === field);
  return (forField ?? result.error.issues[0])?.message ?? "Invalid value";
}

/* -------------------------------------------------------------------------- */
/*  Column builder                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build the product grid columns, injecting the live category list so the
 * category `select` offers the real, colored options.
 *
 * @param categories - all categories (admin list, incl. inactive) for options.
 * @param brands - active brands for the brand `select` column. INTEGRATOR: the
 *   grid page must load these via `listActiveBrands()` and pass them here;
 *   defaults to empty so existing callers keep compiling until wired.
 */
export function buildProductColumns(
  categories: readonly CategoryDTO[],
  brands: readonly BrandOption[] = [],
): ColumnDef<ProductRow>[] {
  const categoryOptions = categories.map((category, index) => ({
    value: category.id,
    label: category.name,
    color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length],
  }));
  const knownCategoryIds = new Set(categories.map((c) => c.id));

  const brandOptions = brands.map((brand) => ({
    value: brand.id,
    label: brand.name,
  }));
  const knownBrandIds = new Set(brands.map((b) => b.id));

  return [
    {
      key: "name",
      header: "Name",
      type: "text",
      pinned: "left",
      width: 240,
      validate: (value) => validatePatch({ name: value as string }, "name"),
    },
    {
      key: "sku",
      header: "SKU",
      type: "text",
      width: 150,
      validate: (value) => validatePatch({ sku: value as string }, "sku"),
    },
    {
      key: "brandId",
      header: "Brand",
      type: "select",
      width: 180,
      options: brandOptions,
      // Brand is optional; empty commits to `undefined` (cleared) server-side.
      // A non-empty value must reference a known brand from the master.
      validate: (value) => {
        if (value === "" || value == null) return null;
        const zodError = validatePatch({ brandId: value as string }, "brandId");
        if (zodError) return zodError;
        return knownBrandIds.has(String(value)) ? null : "Unknown brand";
      },
    },
    {
      key: "categoryId",
      header: "Category",
      type: "select",
      width: 180,
      options: categoryOptions,
      validate: (value) => {
        const zodError = validatePatch(
          { categoryId: value as string },
          "categoryId",
        );
        if (zodError) return zodError;
        return knownCategoryIds.has(String(value)) ? null : "Unknown category";
      },
    },
    {
      key: "price",
      header: "Price",
      type: "currency",
      width: 130,
      format: (value) => (value == null ? "" : formatPaise(value as number)),
      // Editor delivers parsed paise (or null); reuse the server paise schema.
      // Variant rows: read-only (the FROM price is recomputed) — guarded.
      validate: guardVariantManaged((value) =>
        validatePatch({ price: value as number }, "price"),
      ),
    },
    {
      key: "mrp",
      header: "MRP",
      type: "currency",
      width: 130,
      format: (value) => (value == null ? "" : formatPaise(value as number)),
      // Variant rows: read-only (managed per variant) — guarded.
      validate: guardVariantManaged((value, row) => {
        if (value == null) return null; // MRP is optional.
        // Pass price too so the server's `mrp >= price` refinement fires here.
        return validatePatch(
          { mrp: value as number, price: row.price },
          "mrp",
        );
      }),
    },
    {
      key: "stockStatus",
      header: "Stock",
      type: "select",
      width: 150,
      options: STOCK_OPTIONS.map((option) => ({ ...option })),
      // Variant rows: read-only (stock rolls up from variants) — guarded.
      validate: guardVariantManaged((value) =>
        validatePatch({ stockStatus: value as StockStatus }, "stockStatus"),
      ),
    },
    {
      key: "status",
      header: "Active",
      type: "toggle",
      width: 110,
      // The toggle stores a boolean; the onSave adapter maps it to the
      // ACTIVE/INACTIVE enum. Validate the mapped enum for server parity.
      validate: (value) =>
        validatePatch(
          { status: (value ? "ACTIVE" : "INACTIVE") as EntityStatus },
          "status",
        ),
    },
    {
      key: "tags",
      header: "Tags",
      type: "multi-tag",
      width: 220,
      validate: (value) => validatePatch({ tags: value as string[] }, "tags"),
    },
    {
      key: "margin",
      header: "Margin",
      type: "computed",
      width: 110,
      compute: (row) => marginLabel(row.price, row.mrp),
    },
    {
      // Read-only, ROW-AWARE indicator. For variant products it reads
      // "from ₹X · N variants" — signalling that price/mrp/stock are managed
      // per variant (open the product to edit) and are FROM floors, not facts.
      // Plain products show an em dash. A `computed` column is inherently
      // read-only for every row, so this cell never accepts input.
      key: "variantSummary",
      header: "Variants",
      type: "computed",
      width: 170,
      compute: (row) =>
        variantSummaryLabel(row.hasVariants, row.variantCount, row.price),
    },
    {
      key: "images",
      header: "Images",
      type: "image",
      width: 120,
      editable: false,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/*  Derived helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Whole-number discount margin of `price` against `mrp`, formatted for the
 * computed cell. Matches the server's `deriveMarginPct` (null when mrp is
 * absent or not above price).
 */
export function marginLabel(price: number, mrp: number | null): string {
  if (mrp == null || mrp <= 0 || mrp <= price) return "—";
  return `${Math.round(((mrp - price) / mrp) * 100)}%`;
}
