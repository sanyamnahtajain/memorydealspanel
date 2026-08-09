import { z } from "zod";
import { entityStatusSchema, objectIdSchema } from "./shared";

/**
 * DeviceModel master zod schemas.
 *
 * A DeviceModel is a first-class catalog master (like Brand): allocation
 * breakdowns reference models by id, so buyers pick from a curated list —
 * "Realme 11 Pro" is spelled exactly one way everywhere. `slug` is derived
 * server-side from `name` (makeUniqueSlug), never client-supplied.
 */
const deviceModelCoreSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "name is too short")
    .max(80, "name is too long"),
  brandName: z.string().trim().min(1).max(40).optional(),
  sortOrder: z.number().int().min(0),
  status: entityStatusSchema,
});

export const createDeviceModelSchema = deviceModelCoreSchema.extend({
  sortOrder: z.number().int().min(0).default(0),
  status: entityStatusSchema.default("ACTIVE"),
});
export type CreateDeviceModelInput = z.infer<typeof createDeviceModelSchema>;

/** Partial update: omitted fields are left unchanged. */
export const updateDeviceModelSchema = deviceModelCoreSchema.partial();
export type UpdateDeviceModelInput = z.infer<typeof updateDeviceModelSchema>;

export const updateDeviceModelActionSchema = z.object({
  id: objectIdSchema,
  patch: updateDeviceModelSchema,
});

export const setDeviceModelStatusActionSchema = z.object({
  id: objectIdSchema,
  status: entityStatusSchema,
});

export const deleteDeviceModelActionSchema = z.object({ id: objectIdSchema });

/**
 * Bulk paste import: one model per line, optionally "Brand | Model" or
 * "Brand<TAB>Model". Size-capped so a runaway paste can't DoS the action.
 */
export const bulkCreateDeviceModelsSchema = z.object({
  text: z.string().min(1).max(100_000),
});

/** Storefront/customer search input (rate-limited at the action layer). */
export const searchDeviceModelsSchema = z.object({
  query: z.string().trim().max(80).default(""),
  /** Scope the search to a product's allocation restriction, when given. */
  productId: objectIdSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
