"use server";

import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { getByIdForViewer } from "@/server/dal/products";
import { objectIdSchema, type StockStatus } from "@/lib/schemas/shared";
import type { PublicProduct, PricedProduct } from "@/server/dto/product";
import type { PublicVariant, PricedVariant } from "@/server/dto/variant";

/**
 * Variant quick-pick sheet action — the data source for the Flipkart-style
 * "Choose options" bottom sheet on listing cards (VariantQuickSheet).
 *
 * Fetched ON OPEN, not at listing render: cards stay as light as before, and
 * the variant payload only ever travels for the product the user actually
 * tapped.
 *
 * PRICE-GATE SAFETY (non-negotiable):
 *  - The viewer is resolved SERVER-SIDE from the session (`resolveViewer`) —
 *    never from anything the client sent.
 *  - The read goes through the gated DAL (`getByIdForViewer`), which uses the
 *    same detail projections as the product page: for a non-priced viewer the
 *    variant money columns are never even selected out of Mongo.
 *  - `pricePaise` is copied ONLY when `canSeePrices(viewer)` is true AND the
 *    DTO structurally carries a price — for a gated viewer it is `null` on
 *    every variant, and `priced` is `false` so the client renders the same
 *    locked "See price" gate a card does.
 *
 * The action never throws to the client: any failure returns `{ ok: false }`
 * and the sheet falls back to navigating to the product page.
 */

/** One pickable variant, price-gated. All quantities are NON-MONETARY. */
export interface SheetVariant {
  id: string;
  /** Human label joined from the option axes ("20000mAh · Black"), else SKU. */
  label: string;
  stockStatus: StockStatus;
  isDefault: boolean;
  /** Variant-level MOQ override; null ⇒ use the product's. NON-MONETARY. */
  moq: number | null;
  /** Variant-level pack multiple override; null ⇒ the product's. NON-MONETARY. */
  packMultiple: number | null;
  /** Integer paise — ONLY for price-authorised viewers; null when gated. */
  pricePaise: number | null;
}

/** The loaded sheet payload. Product-level fields are all NON-MONETARY. */
export interface VariantSheetData {
  ok: true;
  name: string;
  slug: string;
  /** Primary product image (thumb preferred), or null. */
  image: string | null;
  /** `canSeePrices(viewer)` — when false, every `pricePaise` is null. */
  priced: boolean;
  /** Product-level MOQ / pack multiple (variant overrides win). */
  moq: number | null;
  packMultiple: number | null;
  /**
   * True when the quick sheet cannot finish the flow and the client must
   * navigate to the product page instead: the product requires a per-model
   * allocation breakdown to be carted (the sheet has no breakdown builder),
   * or there are fewer than 2 pickable variants (nothing to quick-pick).
   */
  needsFullPage: boolean;
  variants: SheetVariant[];
}

export type VariantSheetResult = VariantSheetData | { ok: false };

/** Primary image (isPrimary flag, else lowest sortOrder), thumb preferred. */
function primaryImageUrl(product: PublicProduct): string | null {
  if (product.images.length === 0) return null;
  const primary =
    product.images.find((img) => img.isPrimary) ??
    [...product.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  if (!primary) return null;
  return primary.thumbUrl ?? primary.url;
}

/**
 * A variant's pill label: its option values in the product's axis order
 * ("20000mAh · Black"). Falls back to any values present, then the SKU, so a
 * malformed row still renders something tappable.
 */
function variantLabel(
  product: PublicProduct,
  variant: PublicVariant | PricedVariant,
): string {
  const ordered = product.optionTypes
    .map((axis) => variant.optionValues[axis.name])
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (ordered.length > 0) return ordered.join(" · ");
  const any = Object.values(variant.optionValues).filter(Boolean);
  return any.length > 0 ? any.join(" · ") : variant.sku;
}

/** Type guard: does this (gated) variant DTO actually carry a price? */
function variantPrice(
  variant: PublicVariant | PricedVariant,
  priced: boolean,
): number | null {
  if (!priced) return null;
  return "price" in variant && typeof variant.price === "number"
    ? variant.price
    : null;
}

/**
 * Load the quick-pick payload for one product, gated to the CURRENT viewer.
 * `productId` is untrusted client input — validated before touching the DB.
 */
export async function getVariantSheetAction(
  productId: unknown,
): Promise<VariantSheetResult> {
  try {
    const parsed = objectIdSchema.safeParse(productId);
    if (!parsed.success) return { ok: false };

    const viewer = await resolveViewer();
    const product: PublicProduct | PricedProduct | null =
      await getByIdForViewer(viewer, parsed.data);
    if (!product || !product.hasVariants) return { ok: false };

    const priced = canSeePrices(viewer);
    const variants: SheetVariant[] = product.variants.map((v) => ({
      id: v.id,
      label: variantLabel(product, v),
      stockStatus: v.stockStatus,
      isDefault: v.isDefault,
      moq: v.moq,
      packMultiple: v.packMultiple,
      pricePaise: variantPrice(v, priced),
    }));

    // `PublicProduct.allocation` is non-null ONLY when a per-model breakdown
    // is required to add to cart (toPublicAllocation drops `required: false`).
    // The sheet has no breakdown builder, so those products — and products
    // with fewer than 2 pickable variants — go to the full product page.
    const needsFullPage = product.allocation !== null || variants.length < 2;

    return {
      ok: true,
      name: product.name,
      slug: product.slug,
      image: primaryImageUrl(product),
      priced,
      moq: product.moq,
      packMultiple: product.packMultiple,
      needsFullPage,
      variants,
    };
  } catch (error) {
    console.error("[actions/variant-sheet] load failed:", error);
    return { ok: false };
  }
}
