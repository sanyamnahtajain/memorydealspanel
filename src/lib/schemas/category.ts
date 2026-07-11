import { z } from "zod";
import { entityStatusSchema, objectIdSchema } from "./shared";
import { gstRateBpsSchema, hsnCodeSchema } from "./product";

// Core field definitions WITHOUT defaults, so that the update schema's
// .partial() means "leave unchanged" rather than "reset to default".
const categoryCoreSchema = z.object({
  name: z.string().trim().min(2, "name is too short").max(80, "name is too long"),
  image: z.url("image must be a valid URL").optional(),
  sortOrder: z.number().int().min(0),
  status: entityStatusSchema,
  parentId: objectIdSchema.nullish(),
  // GST defaults for products in this category (non-monetary). Each is a
  // fallback in the effective-tax chain; `null`/absent means "no default here".
  defaultHsnCode: hsnCodeSchema.nullish(),
  defaultGstRateBps: gstRateBpsSchema.nullish(),
});

/**
 * Category create input. `slug` is intentionally absent — it is derived
 * server-side from `name` via lib/slug (makeUniqueSlug).
 */
export const createCategorySchema = categoryCoreSchema.extend({
  sortOrder: z.number().int().min(0).default(0),
  status: entityStatusSchema.default("ACTIVE"),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** Partial update: omitted fields are left unchanged (no default injection). */
export const updateCategorySchema = categoryCoreSchema.partial();
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
