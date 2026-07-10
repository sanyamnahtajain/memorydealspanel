import { z } from "zod";
import { MAX_IMAGES_PER_PRODUCT } from "../constants";
import {
  entityStatusSchema,
  objectIdSchema,
  stockStatusSchema,
} from "./shared";

/** Positive integer paise (₹499.50 === 49950). Money is never a float. */
export const paiseSchema = z
  .number("price must be a number")
  .int("money must be integer paise")
  .positive("amount must be greater than zero")
  .max(Number.MAX_SAFE_INTEGER);

/** Mirrors the embedded ProductImage composite type in prisma/schema.prisma. */
export const productImageSchema = z.object({
  url: z.url("image url must be a valid URL"),
  thumbUrl: z.url("thumbnail url must be a valid URL").optional(),
  sortOrder: z.number().int().min(0).default(0),
  isPrimary: z.boolean().default(false),
});
export type ProductImageInput = z.infer<typeof productImageSchema>;

const imagesSchema = z
  .array(productImageSchema)
  .max(
    MAX_IMAGES_PER_PRODUCT,
    `at most ${MAX_IMAGES_PER_PRODUCT} images per product`,
  );

// Core field definitions WITHOUT defaults, so that the update schema's
// .partial() means "leave unchanged" rather than "reset to default".
const productCoreSchema = z.object({
  categoryId: objectIdSchema,
  name: z.string().trim().min(2, "name is too short").max(160, "name is too long"),
  sku: z
    .string()
    .trim()
    .min(1, "sku is required")
    .max(64, "sku is too long")
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      "sku may only contain letters, digits, dots, underscores and hyphens",
    ),
  brand: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(5000).optional(),
  specs: z.record(z.string().min(1), z.string()).optional(),
  price: paiseSchema,
  mrp: paiseSchema.optional(),
  moq: z.number().int().positive().optional(),
  stockStatus: stockStatusSchema,
  status: entityStatusSchema,
  tags: z.array(z.string().trim().min(1)).max(20),
  images: imagesSchema,
});

const mrpNotBelowPrice: { message: string; path: string[] } = {
  message: "mrp must be greater than or equal to price",
  path: ["mrp"],
};

/**
 * Product create input. `slug` is derived server-side from `name`
 * via lib/slug (makeUniqueSlug), so it is not part of the input.
 */
export const createProductSchema = productCoreSchema
  .extend({
    stockStatus: stockStatusSchema.default("IN_STOCK"),
    status: entityStatusSchema.default("ACTIVE"),
    tags: z.array(z.string().trim().min(1)).max(20).default([]),
    images: imagesSchema.default([]),
  })
  .refine(
    (data) => data.mrp === undefined || data.mrp >= data.price,
    mrpNotBelowPrice,
  );
export type CreateProductInput = z.infer<typeof createProductSchema>;

/** Partial update: omitted fields are left unchanged (no default injection). */
export const updateProductSchema = productCoreSchema.partial().refine(
  (data) =>
    data.mrp === undefined ||
    data.price === undefined ||
    data.mrp >= data.price,
  mrpNotBelowPrice,
);
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
