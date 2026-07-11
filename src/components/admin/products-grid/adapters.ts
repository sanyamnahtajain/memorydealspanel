/**
 * Row + patch adapters between the product domain (`PricedProduct`,
 * `UpdateProductInput`) and the generic grid's `ProductRow` / grid patch.
 *
 * The grid is domain-agnostic: it hands `onSave(rowId, patch)` a `Partial<Row>`
 * keyed by the same keys as `ProductRow`. Two keys diverge from the server
 * field names and need translation:
 *   - `status` is a boolean toggle in the grid → `"ACTIVE" | "INACTIVE"` enum.
 *   - `margin` / `images` are display-only and are never persisted.
 * Everything else (name, sku, brand, categoryId, price, mrp, stockStatus, tags)
 * maps one-to-one, and money is already integer paise on both sides.
 */

import type { AdminGridProduct } from "@/server/dal/products";
import type { UpdateProductInput } from "@/lib/schemas/product";
import type { EntityStatus } from "@/lib/schemas/shared";
import type { ProductRow } from "./productColumns";

/** Project a priced product (admin grid read) into a grid row. */
export function toProductRow(product: AdminGridProduct): ProductRow {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    brand: product.brand,
    // Brand master is authoritative — the editable `brandId` select column reads
    // this. The legacy free-text `brand` above stays read-through for back-compat.
    brandId: product.brandRef?.id ?? null,
    categoryId: product.categoryId,
    price: product.price,
    mrp: product.mrp,
    stockStatus: product.stockStatus,
    status: product.status,
    tags: product.tags,
    images: product.images.length,
    // Variant-awareness: when true the grid renders price/mrp/stock read-only
    // ("from ₹X · N variants") and refuses to persist edits to them, because
    // those are recomputed FROM values owned by the variant matrix. Non-variant
    // rows keep behaving exactly as before. `hasVariants` defaults false and
    // `variants` is `[]` for the vast majority of the catalog.
    hasVariants: product.hasVariants,
    // Active-variant count from the grid read's `_count` (the grid never joins
    // full variant rows, so `product.variants` is `[]` here).
    variantCount: product.variantCount,
    // GST overrides — raw stored values (null = inherit). Rate is stored as bps;
    // the grid edits it as a percent, so convert bps → percent here.
    hsnCode: product.hsnCode,
    gstRatePercent:
      product.gstRateBps == null ? null : product.gstRateBps / 100,
    updatedAt: product.updatedAt.getTime(),
  };
}

/**
 * Translate a grid patch (partial `ProductRow`) into a server
 * `UpdateProductInput`. Display-only keys are dropped; the boolean `status`
 * toggle becomes the enum; an empty `brand` string becomes `undefined` so the
 * server clears it rather than rejecting a zero-length brand.
 *
 * Returns `null` when the patch contains nothing persistable (e.g. an edit that
 * only touched a computed column), so the caller can no-op.
 */
export function toUpdateInput(
  patch: Partial<ProductRow>,
): UpdateProductInput | null {
  const out: UpdateProductInput = {};

  if ("name" in patch && patch.name !== undefined) out.name = patch.name;
  if ("sku" in patch && patch.sku !== undefined) out.sku = patch.sku;
  if ("brandId" in patch) {
    // The brand select commits a Brand-master id, or "" / null when cleared.
    // An empty value becomes `undefined` so the service clears the brand link
    // (and mirrors the legacy `brand` string) rather than rejecting a blank id.
    const brandId =
      typeof patch.brandId === "string" ? patch.brandId.trim() : patch.brandId;
    out.brandId = brandId ? brandId : undefined;
  }
  if ("categoryId" in patch && patch.categoryId !== undefined) {
    out.categoryId = patch.categoryId;
  }
  if ("price" in patch && patch.price !== undefined) out.price = patch.price;
  if ("mrp" in patch) out.mrp = patch.mrp ?? undefined;
  if ("stockStatus" in patch && patch.stockStatus !== undefined) {
    out.stockStatus = patch.stockStatus;
  }
  if ("status" in patch && patch.status !== undefined) {
    // The grid toggle may send a boolean or the enum string; normalise both.
    const raw = patch.status as boolean | EntityStatus;
    out.status =
      typeof raw === "boolean" ? (raw ? "ACTIVE" : "INACTIVE") : raw;
  }
  if ("tags" in patch && patch.tags !== undefined) out.tags = patch.tags;
  // GST overrides. HSN: empty/null clears the override (inherit). GST% (percent)
  // → integer bps; empty/null clears the override. Both are NON-MONETARY.
  if ("hsnCode" in patch) {
    const hsn =
      typeof patch.hsnCode === "string" ? patch.hsnCode.trim() : patch.hsnCode;
    out.hsnCode = hsn ? hsn : null;
  }
  if ("gstRatePercent" in patch) {
    const pct = patch.gstRatePercent;
    out.gstRateBps =
      pct == null || pct === ("" as unknown) ? null : Math.round(Number(pct) * 100);
  }

  return Object.keys(out).length > 0 ? out : null;
}
