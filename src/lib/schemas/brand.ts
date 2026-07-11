import { z } from "zod";
import { entityStatusSchema, objectIdSchema } from "./shared";

/**
 * Brand master zod schemas.
 *
 * A Brand is a first-class catalog master: products reference it by id so a
 * dropdown replaces free-text entry (no typos). `slug` is intentionally absent
 * from these schemas — it is derived server-side from `name` via lib/slug
 * (makeUniqueSlug), exactly like Category.
 *
 * Core fields carry NO defaults so the update schema's `.partial()` means
 * "leave unchanged" rather than "reset to default".
 */
const brandCoreSchema = z.object({
  name: z.string().trim().min(2, "name is too short").max(80, "name is too long"),
  logo: z.url("logo must be a valid URL").optional(),
  sortOrder: z.number().int().min(0),
  status: entityStatusSchema,
});

/**
 * Brand create input. Callers may omit `sortOrder`/`status`; the service
 * appends new brands after existing siblings and defaults to ACTIVE.
 */
export const createBrandSchema = brandCoreSchema.extend({
  sortOrder: z.number().int().min(0).default(0),
  status: entityStatusSchema.default("ACTIVE"),
});
export type CreateBrandInput = z.infer<typeof createBrandSchema>;

/** Partial update: omitted fields are left unchanged (no default injection). */
export const updateBrandSchema = brandCoreSchema.partial();
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;

/** Wraps an update action's { id, patch } payload for a single parse. */
export const updateBrandActionSchema = z.object({
  id: objectIdSchema,
  patch: updateBrandSchema,
});

export const setBrandStatusActionSchema = z.object({
  id: objectIdSchema,
  status: entityStatusSchema,
});

export const deleteBrandActionSchema = z.object({ id: objectIdSchema });

export const brandLogoUploadTargetSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z
    .string()
    .trim()
    .regex(
      /^image\/(png|jpe?g|webp|avif|gif|svg\+xml)$/i,
      "Only image files are allowed.",
    ),
});
