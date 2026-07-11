import { z } from "zod";

import { isValidGstin, GST_STATE_CODES } from "@/lib/gstin";

/**
 * Input schema + result type for the CUSTOMER-facing business-profile update.
 *
 * This lives in a plain module (NOT a "use server" file) because the
 * server-actions loader permits only async-function exports from
 * `@/server/actions/customers-profile.ts`; the zod schema and the result type
 * must therefore be imported from here.
 *
 * A retailer edits their own record only (the action ignores any client id and
 * uses `viewer.customerId`). GSTIN is optional — an unregistered buyer can
 * clear it — but when present it must pass the official checksum; the seller
 * needs a real GSTIN to derive the buyer's state and split CGST/SGST vs IGST
 * correctly. The place-of-supply state is captured explicitly so the split is
 * right even for an unregistered buyer who has no GSTIN.
 */

/** The set of valid 2-digit GST state codes, for the place-of-supply Select. */
const STATE_CODE_KEYS = Object.keys(GST_STATE_CODES);

export const businessProfileSchema = z.object({
  /** Registered / trading business name (required, always present on Customer). */
  businessName: z
    .string()
    .trim()
    .min(1, "Business name is required")
    .max(200, "Business name is too long"),
  /**
   * GSTIN. Empty string ⇒ the buyer clears it (treated as unregistered). When
   * non-empty it must be a structurally valid GSTIN with a correct checksum.
   */
  gstNumber: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => s === "" || isValidGstin(s), {
      message: "Enter a valid 15-character GSTIN, or leave it blank.",
    }),
  /**
   * Explicit place-of-supply (billing) state code. Empty string ⇒ not set.
   * When non-empty it must be a known GST state code.
   */
  placeOfSupplyStateCode: z
    .string()
    .trim()
    .refine((s) => s === "" || STATE_CODE_KEYS.includes(s), {
      message: "Choose a valid state.",
    }),
});

export type BusinessProfileInput = z.input<typeof businessProfileSchema>;

/** Discriminated result the client form renders (never throws to the client). */
export type BusinessProfileResult =
  | { ok: true }
  | { ok: false; error: string };
