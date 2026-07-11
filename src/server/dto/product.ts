import type { Prisma, ProductImage } from "@prisma/client";
import type { EntityStatus, StockStatus } from "@/lib/schemas/shared";
import type { TaxTreatment } from "@/lib/gst";
import { computeLineTax } from "@/lib/gst";
import type { EffectiveTax } from "@/lib/tax-inherit";
import {
  toPublicVariant,
  toPricedVariant,
  type PublicVariant,
  type PricedVariant,
  type PublicVariantSource,
  type PricedVariantSource,
} from "./variant";

/**
 * Product DTOs — the serialization half of the price gate.
 *
 * `PublicProduct` is what an unauthorised viewer (anon, pending, expired,
 * blocked, or a rejected customer) is allowed to see. It has NO `price`,
 * `mrp`, or `marginPct` fields — not merely `undefined`, but structurally
 * absent, so `"price" in dto` is `false`. Because these mappers copy an
 * explicit allow-list of fields (never `{ ...raw }`), a price value can
 * never leak by accident even if a caller hands us a full Prisma row.
 *
 * `PricedProduct` extends the public shape with the money fields. It is only
 * ever produced for viewers where `canSeePrices(viewer)` is true (see
 * src/server/dal/products.ts). The DAL additionally uses a Mongo projection
 * so that, for non-priced viewers, the price never even enters Node.
 */

/** Public projection of a product image (identical shape, explicit copy). */
export interface PublicProductImage {
  url: string;
  thumbUrl: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

/**
 * Public projection of the referenced Brand master. Brand data (name / slug)
 * is PUBLIC — it carries no pricing — so it appears on `PublicProduct` too.
 * `null` when the product references no brand.
 */
export interface PublicProductBrand {
  id: string;
  name: string;
  slug: string;
}

/**
 * One axis of variation (embedded on `Product.optionTypes`), e.g.
 * `{ name: "Capacity", values: ["10000mAh", "20000mAh"] }`. Carries NO price —
 * it is PUBLIC and describes the shape of the variant selector for every
 * viewer. `null` / absent when the product has no variants.
 */
export interface ProductOptionType {
  name: string;
  values: string[];
}

/**
 * A product without any pricing information. This is the DEFAULT return
 * shape of the DAL — prices are opt-in and gated.
 */
export interface PublicProduct {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  sku: string;
  /** Legacy free-text brand string (back-compat). Prefer `brand.name`. */
  brand: string | null;
  /** The referenced Brand master (PUBLIC — no price). Null when unset. */
  brandRef: PublicProductBrand | null;
  description: string | null;
  specs: unknown;
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
  tags: string[];
  images: PublicProductImage[];
  createdAt: Date;
  updatedAt: Date;
  /**
   * Whether this product is split into purchasable variants. When `false`
   * (the default and the vast majority of the catalog) the product behaves
   * EXACTLY as before: `variants` is `[]` and `optionTypes` is `[]`.
   */
  hasVariants: boolean;
  /**
   * Embedded axis definitions for the variant selector (PUBLIC — no price).
   * Empty when `hasVariants` is false.
   */
  optionTypes: ProductOptionType[];
  /**
   * The product's variants, price-gated to the PUBLIC shape (no money).
   * Empty when `hasVariants` is false.
   */
  variants: PublicVariant[];
  /**
   * NON-MONETARY GST metadata (HSN / rate bps / inclusive flag) — safe for
   * every viewer. `gstRateBps: null` when the GST kill-switch is off, so the
   * storefront renders no GST hint. NEVER carries a paise amount.
   */
  tax: PublicTaxMeta;
}

/**
 * A product WITH pricing. All money is integer paise (see src/lib/money.ts).
 * `marginPct` is a derived, rounded whole-number percentage of margin over
 * the selling price ((mrp - price) / mrp), present only when an `mrp` exists.
 */
export interface PricedProduct extends PublicProduct {
  /** Selling price in integer paise. */
  price: number;
  /** Maximum retail price in integer paise, when set. */
  mrp: number | null;
  /** Whole-number discount margin percentage vs. mrp, when mrp is set. */
  marginPct: number | null;
  /** Variants carrying their own gated price/mrp/margin. Empty when none. */
  variants: PricedVariant[];
  /**
   * The paise GST breakdown of the displayed `price`. The ONLY place a tax
   * amount appears — present only on this Priced projection, reached only by an
   * approved viewer. `null` when the GST kill-switch is off.
   */
  taxBreakdown: PricedTaxBreakdown | null;
}

/**
 * The subset of Prisma `Product` fields the public mapper reads, defined
 * structurally so that either a projected row (no price/mrp) OR a full row
 * satisfies it. Money fields are optional and never read here.
 */
export interface PublicSource {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  sku: string;
  brand: string | null;
  /**
   * The joined Brand relation. `null` when `brandId` is unset. Only these
   * three PUBLIC fields are ever selected in the DAL — never any price.
   */
  brandRef?: { id: string; name: string; slug: string } | null;
  description: string | null;
  specs: Prisma.JsonValue;
  moq: number | null;
  stockStatus: StockStatus;
  status: EntityStatus;
  tags: string[];
  images: ProductImage[];
  createdAt: Date;
  updatedAt: Date;
  price?: number;
  mrp?: number | null;
  /**
   * GST override fields — NON-MONETARY metadata, so they are safe to select on
   * the gated path too. Feed the effective-tax resolver; never read as amounts.
   */
  hsnCode?: string | null;
  gstRateBps?: number | null;
  taxTreatment?: TaxTreatment | null;
  /** Absent / false for the non-variant majority of the catalog. */
  hasVariants?: boolean;
  /** Embedded axis definitions; null/absent when there are no variants. */
  optionTypes?: Prisma.JsonValue;
  /**
   * The joined variant rows. For gated viewers these are PUBLIC-projected
   * (no price columns selected); for priced viewers they include money.
   */
  variants?: PublicVariantSource[];
}

/** The fields the priced mapper additionally requires. */
export interface PricedSource extends PublicSource {
  price: number;
  mrp?: number | null;
  /** Priced viewers get variant rows including the money columns. */
  variants?: PricedVariantSource[];
}

/* ---------------------------------------------------------------------- */
/* GST projections — the price-gated tax metadata / breakdown             */
/* ---------------------------------------------------------------------- */

/**
 * NON-MONETARY GST metadata that is safe for EVERY viewer (anon included).
 * It carries NO paise: only the HSN code, the effective rate in basis points,
 * and whether the *shown* price is inclusive of that rate. The storefront uses
 * it to render a neutral "incl. 18% GST" / "+ 18% GST" hint with no amount.
 *
 * When the GST kill-switch is off (or no effective rate resolves) the fields
 * are null/`gstRateBps: null`, so the UI renders nothing. Because this is pure
 * metadata (an allow-list, never a paise value), it lives on the PUBLIC shape.
 */
export interface PublicTaxMeta {
  /** Resolved HSN code, or null when none is configured anywhere. */
  hsnCode: string | null;
  /** Effective GST rate in basis points (1800 = 18%), or null when GST is off. */
  gstRateBps: number | null;
  /** Whether the displayed price already includes the GST above. */
  taxInclusive: boolean;
}

/**
 * The paise tax breakdown of the DISPLAYED price. This is the ONLY place a GST
 * paise amount appears in a product DTO, and it lives EXCLUSIVELY on the Priced
 * projection — a gated viewer never receives it (structurally absent). Computed
 * via {@link computeLineTax} from the stored price and the resolved treatment.
 *
 * `taxablePaise + taxPaise === grossPaise` holds exactly (integer-only).
 */
export interface PricedTaxBreakdown {
  /** GST-exclusive taxable base in paise. */
  taxablePaise: number;
  /** GST amount in paise for the displayed price. */
  taxPaise: number;
  /** Landed, tax-inclusive amount in paise. */
  grossPaise: number;
  /** Effective GST rate in basis points. */
  gstRateBps: number;
  /** Effective treatment of the stored price. */
  treatment: TaxTreatment;
}

/**
 * Options passed to the mappers when GST is being threaded through. `null`
 * (the default) means the GST kill-switch is off (or the caller opted out): the
 * public metadata degrades to `gstRateBps: null` and no priced breakdown is
 * computed, so every DTO keeps its exact pre-GST shape.
 */
export interface TaxMapOptions {
  /** The fully-resolved effective tax for this product, or null when GST is off. */
  effective: EffectiveTax | null;
}

/**
 * Derives the PUBLIC (amount-free) GST metadata from an effective tax. Returns
 * the "GST off" shape (`gstRateBps: null`, `taxInclusive: false`) when
 * `effective` is null. Never carries paise.
 */
export function publicTaxMetaOf(effective: EffectiveTax | null): PublicTaxMeta {
  if (effective === null) {
    return { hsnCode: null, gstRateBps: null, taxInclusive: false };
  }
  return {
    hsnCode: effective.hsnCode,
    gstRateBps: effective.gstRateBps,
    taxInclusive: effective.treatment === "TAX_INCLUSIVE",
  };
}

/**
 * Computes the PRICED tax breakdown for a displayed price. Returns null when
 * `effective` is null (GST off) so the priced DTO carries `taxBreakdown: null`
 * and behaves exactly as pre-GST. Pure — delegates the arithmetic to
 * {@link computeLineTax}.
 */
export function pricedTaxBreakdownOf(
  pricePaise: number,
  effective: EffectiveTax | null,
): PricedTaxBreakdown | null {
  if (effective === null) return null;
  const line = computeLineTax({
    amountPaise: pricePaise,
    gstRateBps: effective.gstRateBps,
    treatment: effective.treatment,
  });
  return {
    taxablePaise: line.taxablePaise,
    taxPaise: line.taxPaise,
    grossPaise: line.grossPaise,
    gstRateBps: effective.gstRateBps,
    treatment: effective.treatment,
  };
}

/**
 * Public projection of product images (identical shape, explicit copy).
 * Exported so the variant mapper can reuse it (variant images share the shape).
 */
export function toPublicImages(images: ProductImage[]): PublicProductImage[] {
  return images.map((image) => ({
    url: image.url,
    thumbUrl: image.thumbUrl ?? null,
    sortOrder: image.sortOrder,
    isPrimary: image.isPrimary,
  }));
}

/**
 * Coerces the free-form `optionTypes` JSON to a clean `ProductOptionType[]`,
 * dropping malformed entries defensively. Returns `[]` for null / non-array /
 * missing input, so a non-variant product always yields an empty axis list.
 */
function toOptionTypes(raw: Prisma.JsonValue | undefined): ProductOptionType[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductOptionType[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.name !== "string" || !Array.isArray(obj.values)) continue;
    const values = obj.values.filter(
      (v): v is string => typeof v === "string",
    );
    out.push({ name: obj.name, values });
  }
  return out;
}

/**
 * Maps a Prisma product row to a `PublicProduct`, copying an explicit
 * allow-list of fields. Price fields are NEVER read here, so even a full
 * row cannot leak money through this mapper — including on nested variants,
 * which are mapped through the PUBLIC variant mapper (no money read).
 */
export function toPublicProduct(
  row: PublicSource,
  opts: TaxMapOptions = { effective: null },
): PublicProduct {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    slug: row.slug,
    sku: row.sku,
    brand: row.brand ?? null,
    brandRef: row.brandRef
      ? { id: row.brandRef.id, name: row.brandRef.name, slug: row.brandRef.slug }
      : null,
    description: row.description ?? null,
    specs: row.specs ?? null,
    moq: row.moq ?? null,
    stockStatus: row.stockStatus,
    status: row.status,
    tags: row.tags ?? [],
    images: toPublicImages(row.images ?? []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    hasVariants: row.hasVariants ?? false,
    optionTypes: toOptionTypes(row.optionTypes),
    // A gated variant carries only public metadata; the product's effective tax
    // is the sensible fallback for a variant that resolved no own override.
    variants: (row.variants ?? []).map((v) =>
      toPublicVariant(v, { effective: opts.effective }),
    ),
    tax: publicTaxMetaOf(opts.effective),
  };
}

/** Derives a whole-number discount percentage of `price` against `mrp`. */
function deriveMarginPct(price: number, mrp: number | null | undefined): number | null {
  if (mrp === null || mrp === undefined || mrp <= 0 || mrp <= price) {
    return null;
  }
  return Math.round(((mrp - price) / mrp) * 100);
}

/**
 * Options for the priced product mapper. `effective` is the product's resolved
 * tax (drives the product-level breakdown and the public metadata); the DAL,
 * which owns the profile + category, resolves it. `variantEffective` lets the
 * DAL supply each variant's own resolved tax (variant→product→category→profile)
 * keyed by variant id — a variant not present in the map falls back to the
 * product's `effective`. All null ⇒ GST kill-switch off ⇒ pre-GST shapes.
 */
export interface PricedTaxMapOptions extends TaxMapOptions {
  variantEffective?: (variantId: string) => EffectiveTax | null;
}

/**
 * Maps a Prisma product row to a `PricedProduct`, layering the money fields
 * onto the public projection. Only ever called for price-authorised viewers.
 */
export function toPricedProduct(
  row: PricedSource,
  opts: PricedTaxMapOptions = { effective: null },
): PricedProduct {
  const price = row.price;
  const mrp = row.mrp ?? null;
  const resolveVariant = opts.variantEffective;
  return {
    ...toPublicProduct(row, { effective: opts.effective }),
    price,
    mrp,
    marginPct: deriveMarginPct(price, mrp),
    // Priced viewers get the money-carrying variant projection, each with its
    // own resolved effective tax (falling back to the product's).
    variants: (row.variants ?? []).map((v) =>
      toPricedVariant(v, {
        effective: resolveVariant ? resolveVariant(v.id) : opts.effective,
      }),
    ),
    taxBreakdown: pricedTaxBreakdownOf(price, opts.effective),
  };
}
