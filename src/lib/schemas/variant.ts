import { z } from "zod";
import { MAX_IMAGES_PER_PRODUCT } from "../constants";
import { paiseSchema, productImageSchema } from "./product";
import { entityStatusSchema, stockStatusSchema } from "./shared";

/**
 * Zod schemas for PRODUCT VARIANTS (PRD Phase 11).
 *
 * Two concerns live here:
 *
 *  1. `optionTypes` — the embedded axis definition stored on `Product`. It is a
 *     list of axes, each with a `name` (e.g. "Capacity") and a non-empty list of
 *     distinct `values` (e.g. ["10000mAh", "20000mAh"]). The cartesian product of
 *     these values enumerates every purchasable combination.
 *
 *  2. A `ProductVariant` row — a specific purchasable combination: its own
 *     globally-unique `sku`, its `optionValues` (one chosen value per axis), and
 *     its own gated money (`price` paise > 0, optional `mrp`), `moq`, stock and
 *     status. Money mirrors the product rules: integer paise, mrp >= price.
 *
 * These validate SHAPE only. Cross-row invariants (unique SKUs across products,
 * no duplicate combos, optionValues covering exactly the declared axes) live in
 * the service layer, which has the DB to check against.
 */

const OPTION_NAME_MAX = 40;
const OPTION_VALUE_MAX = 60;
const MAX_OPTION_TYPES = 4;
const MAX_VALUES_PER_TYPE = 50;

const optionNameSchema = z
  .string()
  .trim()
  .min(1, "option name is required")
  .max(OPTION_NAME_MAX, "option name is too long");

const optionValueSchema = z
  .string()
  .trim()
  .min(1, "option value is required")
  .max(OPTION_VALUE_MAX, "option value is too long");

/** A single option axis: a name plus its distinct, ordered values. */
export const optionTypeSchema = z
  .object({
    name: optionNameSchema,
    values: z
      .array(optionValueSchema)
      .min(1, "each option needs at least one value")
      .max(MAX_VALUES_PER_TYPE, `at most ${MAX_VALUES_PER_TYPE} values per option`)
      .refine(
        (values) =>
          new Set(values.map((v) => v.toLowerCase())).size === values.length,
        "option values must be distinct",
      ),
  })
  .strict();
export type OptionTypeInput = z.infer<typeof optionTypeSchema>;

/**
 * The full set of axes for a product. Axis names must be distinct
 * (case-insensitive) so `optionValues` keys are unambiguous.
 */
export const optionTypesSchema = z
  .array(optionTypeSchema)
  .max(MAX_OPTION_TYPES, `at most ${MAX_OPTION_TYPES} option types`)
  .refine(
    (types) =>
      new Set(types.map((t) => t.name.toLowerCase())).size === types.length,
    "option names must be distinct",
  );
export type OptionTypesInput = z.infer<typeof optionTypesSchema>;

const variantImagesSchema = z
  .array(productImageSchema)
  .max(
    MAX_IMAGES_PER_PRODUCT,
    `at most ${MAX_IMAGES_PER_PRODUCT} images per variant`,
  );

/**
 * `optionValues` for a variant: one chosen value per axis, keyed by axis name.
 * e.g. `{ Capacity: "20000mAh", Color: "Black" }`. Shape only — the service
 * verifies the keys/values match the product's declared `optionTypes`.
 */
export const optionValuesSchema = z.record(
  optionNameSchema,
  optionValueSchema,
);
export type OptionValues = z.infer<typeof optionValuesSchema>;

const mrpNotBelowPrice: { message: string; path: string[] } = {
  message: "mrp must be greater than or equal to price",
  path: ["mrp"],
};

const variantSkuSchema = z
  .string()
  .trim()
  .min(1, "sku is required")
  .max(64, "sku is too long")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "sku may only contain letters, digits, dots, underscores and hyphens",
  );

// Core variant fields WITHOUT defaults so the update schema's `.partial()`
// means "leave unchanged" rather than "reset to default".
const variantCoreSchema = z.object({
  sku: variantSkuSchema,
  optionValues: optionValuesSchema,
  price: paiseSchema,
  mrp: paiseSchema.optional(),
  moq: z.number().int().positive().optional(),
  stockStatus: stockStatusSchema,
  status: entityStatusSchema,
  images: variantImagesSchema,
  isDefault: z.boolean(),
  sortOrder: z.number().int().min(0),
});

/** Create input for a single variant (defaults applied for optional fields). */
export const createVariantSchema = variantCoreSchema
  .extend({
    stockStatus: stockStatusSchema.default("IN_STOCK"),
    status: entityStatusSchema.default("ACTIVE"),
    images: variantImagesSchema.default([]),
    isDefault: z.boolean().default(false),
    sortOrder: z.number().int().min(0).default(0),
  })
  .refine(
    (data) => data.mrp === undefined || data.mrp >= data.price,
    mrpNotBelowPrice,
  );
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

/** Partial update: omitted fields are left unchanged (no default injection). */
export const updateVariantSchema = variantCoreSchema.partial().refine(
  (data) =>
    data.mrp === undefined ||
    data.price === undefined ||
    data.mrp >= data.price,
  mrpNotBelowPrice,
);
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
