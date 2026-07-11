/**
 * Tax-inheritance resolver — pure, no React / Prisma runtime / I/O.
 *
 * A product (or variant) may leave its GST fields unset, in which case the
 * effective tax is inherited down a fixed precedence chain:
 *
 *   variant  →  product  →  category defaults  →  seller tax profile
 *
 * Each of `hsnCode`, `gstRateBps`, and `treatment` is resolved INDEPENDENTLY:
 * a product may pin its HSN code but inherit the rate from its category, etc.
 * The seller profile is the final backstop and always supplies a concrete
 * `gstRateBps` and `treatment` (its schema defaults guarantee non-null values),
 * so the resolved rate/treatment are never null. `hsnCode` may legitimately be
 * null all the way down (no code configured anywhere).
 *
 * This module is Prisma-free: `TaxTreatment` is the same string-literal union
 * the Prisma enum exports (see `src/lib/gst.ts`), so the shapes here accept the
 * DB rows directly without importing `@prisma/client`.
 */

import type { TaxTreatment } from "./gst";

/* ---------------------------------------------------------------------- */
/* Input shapes (structural — accept Prisma rows or plain objects)        */
/* ---------------------------------------------------------------------- */

/**
 * The GST-bearing fields of a product or variant. Every field is nullable /
 * optional: an unset field defers to the next level in the precedence chain.
 * `taxTreatment` on the entity is treated as an override of the profile's
 * `priceEntryMode` when present.
 */
export interface TaxOverridable {
  hsnCode?: string | null;
  gstRateBps?: number | null;
  taxTreatment?: TaxTreatment | null;
}

/** Category-level defaults (a subset — categories carry no treatment). */
export interface CategoryTaxDefaults {
  defaultHsnCode?: string | null;
  defaultGstRateBps?: number | null;
}

/**
 * The seller tax profile fields that seed the backstop. `priceEntryMode` and
 * `defaultGstRateBps` are non-null in the schema; `defaultHsnCode` may be null.
 */
export interface ProfileTaxDefaults {
  defaultHsnCode?: string | null;
  defaultGstRateBps: number;
  priceEntryMode: TaxTreatment;
}

/** The fully-resolved effective tax for a line item. */
export interface EffectiveTax {
  /** Resolved HSN code, or null when none is configured anywhere. */
  hsnCode: string | null;
  /** Resolved GST rate in basis points (always concrete). */
  gstRateBps: number;
  /** Resolved storage/entry treatment (always concrete). */
  treatment: TaxTreatment;
}

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

/** A string field "counts" only when it is a non-empty, non-whitespace value. */
function firstHsn(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim() !== "") return c.trim();
  }
  return null;
}

/** A bps field "counts" only when it is a finite, non-negative integer. */
function firstBps(...candidates: (number | null | undefined)[]): number | null {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isInteger(c) && c >= 0) return c;
  }
  return null;
}

/** A treatment field "counts" only when it is one of the two enum members. */
function firstTreatment(
  ...candidates: (TaxTreatment | null | undefined)[]
): TaxTreatment | null {
  for (const c of candidates) {
    if (c === "TAX_EXCLUSIVE" || c === "TAX_INCLUSIVE") return c;
  }
  return null;
}

/* ---------------------------------------------------------------------- */
/* Resolver                                                               */
/* ---------------------------------------------------------------------- */

/**
 * Resolves the effective tax for a single product-ish entity given its
 * category defaults and the seller profile. Precedence per field:
 *   entity → category → profile.
 *
 * The profile always provides a concrete `gstRateBps` and `treatment`, so the
 * result's rate/treatment are never null. HSN may resolve to null.
 */
export function resolveEffectiveTax(args: {
  entity: TaxOverridable;
  category?: CategoryTaxDefaults | null;
  profile: ProfileTaxDefaults;
}): EffectiveTax {
  const { entity, category, profile } = args;

  return {
    hsnCode: firstHsn(
      entity.hsnCode,
      category?.defaultHsnCode,
      profile.defaultHsnCode,
    ),
    gstRateBps:
      firstBps(
        entity.gstRateBps,
        category?.defaultGstRateBps,
        profile.defaultGstRateBps,
      ) ?? profile.defaultGstRateBps,
    treatment:
      firstTreatment(entity.taxTreatment, profile.priceEntryMode) ??
      profile.priceEntryMode,
  };
}

/**
 * Resolves the effective tax for a VARIANT, honouring the full chain:
 *   variant → product → category → profile.
 *
 * A variant that leaves a field unset falls back to its parent product's value
 * before reaching the category / profile. Implemented by layering the variant's
 * own overrides over the product's, per field, then delegating to
 * {@link resolveEffectiveTax}.
 */
export function resolveVariantEffectiveTax(args: {
  variant: TaxOverridable;
  product: TaxOverridable;
  category?: CategoryTaxDefaults | null;
  profile: ProfileTaxDefaults;
}): EffectiveTax {
  const { variant, product, category, profile } = args;

  const merged: TaxOverridable = {
    hsnCode: firstHsn(variant.hsnCode, product.hsnCode),
    gstRateBps: firstBps(variant.gstRateBps, product.gstRateBps),
    taxTreatment: firstTreatment(variant.taxTreatment, product.taxTreatment),
  };

  return resolveEffectiveTax({ entity: merged, category, profile });
}
