import { z } from "zod";

import { GST_STATE_CODES } from "@/lib/gstin";

/**
 * Zod schema + result type for the tax-settings action.
 *
 * Kept out of the "use server" module (`./tax-settings`) because that loader
 * permits ONLY async-function exports — schemas and types must live here and be
 * imported.
 *
 * The form sends the GST rate as a PERCENT (e.g. 18); the action converts it to
 * basis points before persisting (the store is always integer bps).
 */

const KNOWN_STATE_CODES = Object.keys(GST_STATE_CODES) as [string, ...string[]];

/** Optional trimmed string → undefined when blank. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : v));

export const taxProfileFormSchema = z.object({
  gstEnabled: z.boolean(),
  gstin: optionalText(15),
  legalName: optionalText(200),
  stateCode: z
    .enum(KNOWN_STATE_CODES, { message: "Select a valid GST state code." })
    .optional()
    .or(z.literal("").transform(() => undefined)),
  priceEntryMode: z.enum(["TAX_EXCLUSIVE", "TAX_INCLUSIVE"]),
  displayMode: z.enum(["INCLUSIVE", "EXCLUSIVE"]),
  roundingMode: z.enum(["LINE", "INVOICE"]),
  defaultGstRatePercent: z
    .number({ message: "Enter a GST rate percentage." })
    .min(0, "Rate cannot be negative.")
    .max(100, "Rate cannot exceed 100%.")
    // At most two decimal places → whole basis points.
    .refine((n) => Number.isInteger(Math.round(n * 100)) && n * 100 % 1 === 0, {
      message: "Rate can have at most two decimal places.",
    }),
  defaultHsnCode: optionalText(20),
});

export type TaxProfileFormInput = z.infer<typeof taxProfileFormSchema>;

export type TaxSettingsResult = { ok: true } | { ok: false; error: string };
