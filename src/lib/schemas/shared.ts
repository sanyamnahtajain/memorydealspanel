import { z } from "zod";

/** 24-character hex MongoDB ObjectId. */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, "must be a 24-character hex ObjectId");
export type ObjectIdString = z.infer<typeof objectIdSchema>;

// Enums mirroring prisma/schema.prisma — keep in lockstep with the schema.
export const entityStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);
export type EntityStatus = z.infer<typeof entityStatusSchema>;

export const stockStatusSchema = z.enum(["IN_STOCK", "LOW", "OUT_OF_STOCK"]);
export type StockStatus = z.infer<typeof stockStatusSchema>;

export const customerStatusSchema = z.enum([
  "PENDING",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "BLOCKED",
]);
export type CustomerStatus = z.infer<typeof customerStatusSchema>;

export const requestStatusSchema = z.enum(["PENDING", "APPROVED", "REJECTED"]);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

/**
 * Wraps an optional schema so that empty / whitespace-only strings coming
 * from HTML form fields are treated as "not provided".
 */
export function emptyStringAsUndefined<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  );
}
