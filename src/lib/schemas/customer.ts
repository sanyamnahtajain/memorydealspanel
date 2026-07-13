import { z } from "zod";
import { emptyStringAsUndefined } from "./shared";

/**
 * Indian mobile number. Accepts "+91 98765 43210", "09876543210",
 * "98765-43210", etc., and normalizes to canonical "+919876543210"
 * (the format stored in Customer.phone, which is unique).
 */
export const indianPhoneSchema = z
  .string("phone is required")
  .trim()
  .transform((value, ctx) => {
    const compact = value.replace(/[\s().-]/g, "");
    const match = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(compact);
    if (!match) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid 10-digit Indian mobile number",
      });
      return z.NEVER;
    }
    return `+91${match[1]}`;
  });

/** 15-character GSTIN, e.g. "27AAPFU0939F1ZV". Uppercased before checking. */
export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
    "Enter a valid 15-character GSTIN",
  );

/**
 * Access-request form (F-C7): creates a PENDING customer.
 * City is REQUIRED; gstNumber/email are optional (empty form fields are treated
 * as "not provided" and GSTIN is validated only when present).
 */
export const accessRequestSchema = z.object({
  businessName: z
    .string("business name is required")
    .trim()
    .min(2, "business name is too short")
    .max(120, "business name is too long"),
  contactName: z
    .string("contact name is required")
    .trim()
    .min(2, "contact name is too short")
    .max(80, "contact name is too long"),
  phone: indianPhoneSchema,
  password: z
    .string("password is required")
    .min(8, "password must be at least 8 characters")
    .max(72, "password is too long"),
  gstNumber: emptyStringAsUndefined(gstinSchema),
  email: emptyStringAsUndefined(z.email("Enter a valid email address")),
  city: z
    .string("city is required")
    .trim()
    .min(2, "city is too short")
    .max(80, "city is too long"),
});
export type AccessRequestInput = z.infer<typeof accessRequestSchema>;

/** Customer login: phone (any accepted format) + password. */
export const customerLoginSchema = z.object({
  phone: indianPhoneSchema,
  password: z.string("password is required").min(1, "password is required"),
});
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;
