import { cache } from "react";
import type { SellerTaxProfile } from "@prisma/client";

import { isValidGstin, gstinStateCode } from "@/lib/gstin";
import { GST_STATE_CODES } from "@/lib/gstin";
import { prisma } from "@/server/db";
import type { ProfileTaxDefaults } from "@/lib/tax-inherit";
import type { TaxTreatment } from "@/lib/gst";

/**
 * Seller tax profile service — the single place that reads and mutates the
 * singleton `SellerTaxProfile` (key="default") document.
 *
 * These functions are transport-agnostic: authorization
 * (`settings.tax.manage`), audit, and revalidation live in
 * `@/server/actions/tax-settings`. Validation that is intrinsic to the data
 * (GSTIN structure + derived state code, rate/HSN normalisation) lives here so
 * the profile can never persist an inconsistent GST identity.
 *
 * The GLOBAL KILL-SWITCH is `gstEnabled`: while it is false the whole GST
 * feature is inert and every downstream consumer must behave exactly as pre-GST.
 */

/** The singleton key — there is exactly one profile row. */
const PROFILE_KEY = "default";

/** Fields we always project (currently the full row; explicit for clarity). */
const PROFILE_SELECT = {
  id: true,
  key: true,
  gstEnabled: true,
  gstin: true,
  legalName: true,
  stateCode: true,
  priceEntryMode: true,
  displayMode: true,
  roundingMode: true,
  defaultGstRateBps: true,
  defaultHsnCode: true,
  createdAt: true,
  updatedAt: true,
} as const;

/* ---------------------------------------------------------------------- */
/* Typed errors                                                           */
/* ---------------------------------------------------------------------- */

/** Thrown when a supplied GSTIN fails the structural + checksum check. */
export class InvalidGstinError extends Error {
  constructor() {
    super("That GSTIN is not valid. Check the 15-character number and retry.");
    this.name = "InvalidGstinError";
  }
}

/** Thrown when a supplied place-of-supply state code is not a known GST code. */
export class InvalidStateCodeError extends Error {
  constructor() {
    super("Select a valid GST state code.");
    this.name = "InvalidStateCodeError";
  }
}

/* ---------------------------------------------------------------------- */
/* Reads                                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Reads the seller tax profile, lazily creating the singleton with schema
 * defaults on first access (so callers never have to null-check the row).
 * Request-memoized with React `cache()` like the other DAL reads.
 */
export const getSellerTaxProfile = cache(
  async (): Promise<SellerTaxProfile> => {
    const existing = await prisma.sellerTaxProfile.findUnique({
      where: { key: PROFILE_KEY },
      select: PROFILE_SELECT,
    });
    if (existing) return existing;

    // First access — materialise the singleton with the schema defaults.
    // `upsert` (not `create`) to be safe against a concurrent first read.
    return prisma.sellerTaxProfile.upsert({
      where: { key: PROFILE_KEY },
      create: { key: PROFILE_KEY },
      update: {},
      select: PROFILE_SELECT,
    });
  },
);

/**
 * Convenience projection for the inheritance resolver: the profile fields that
 * seed the tax-inheritance backstop (`src/lib/tax-inherit.ts`). Reads the
 * singleton via {@link getSellerTaxProfile}.
 */
export async function getProfileTaxDefaults(): Promise<ProfileTaxDefaults> {
  const p = await getSellerTaxProfile();
  return {
    defaultHsnCode: p.defaultHsnCode,
    defaultGstRateBps: p.defaultGstRateBps,
    priceEntryMode: p.priceEntryMode,
  };
}

/* ---------------------------------------------------------------------- */
/* Mutations                                                              */
/* ---------------------------------------------------------------------- */

/**
 * The editable shape of the tax profile. All fields optional so the action can
 * pass exactly what the form sends; omitted fields are left unchanged.
 */
export interface UpdateSellerTaxProfileInput {
  gstEnabled?: boolean;
  gstin?: string | null;
  legalName?: string | null;
  stateCode?: string | null;
  priceEntryMode?: TaxTreatment;
  displayMode?: "INCLUSIVE" | "EXCLUSIVE";
  roundingMode?: "LINE" | "INVOICE";
  defaultGstRateBps?: number;
  defaultHsnCode?: string | null;
}

/** Trims a string to a non-empty value or null. */
function nullableTrim(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Upserts the singleton tax profile. Intrinsic validation:
 *  - a non-empty GSTIN must pass {@link isValidGstin}; when valid its embedded
 *    state code seeds `stateCode` if the caller left it unset;
 *  - an explicit `stateCode` must be a known GST code.
 *
 * Authorization and audit are the caller's responsibility (action layer). The
 * returned row is the freshly persisted profile.
 */
export async function updateSellerTaxProfile(
  input: UpdateSellerTaxProfileInput,
): Promise<SellerTaxProfile> {
  const data: Record<string, unknown> = {};

  if (input.gstEnabled !== undefined) data.gstEnabled = input.gstEnabled;

  const gstin = nullableTrim(input.gstin);
  let derivedStateCode: string | null | undefined;
  if (gstin !== undefined) {
    if (gstin === null) {
      data.gstin = null;
    } else {
      const canonical = gstin.toUpperCase();
      if (!isValidGstin(canonical)) {
        throw new InvalidGstinError();
      }
      data.gstin = canonical;
      derivedStateCode = gstinStateCode(canonical);
    }
  }

  const legalName = nullableTrim(input.legalName);
  if (legalName !== undefined) data.legalName = legalName;

  // Explicit stateCode wins; otherwise inherit the GSTIN's embedded code.
  const stateCode = nullableTrim(input.stateCode);
  const effectiveStateCode =
    stateCode !== undefined ? stateCode : derivedStateCode;
  if (effectiveStateCode !== undefined) {
    if (effectiveStateCode !== null && !(effectiveStateCode in GST_STATE_CODES)) {
      throw new InvalidStateCodeError();
    }
    data.stateCode = effectiveStateCode;
  }

  if (input.priceEntryMode !== undefined) data.priceEntryMode = input.priceEntryMode;
  if (input.displayMode !== undefined) data.displayMode = input.displayMode;
  if (input.roundingMode !== undefined) data.roundingMode = input.roundingMode;

  if (input.defaultGstRateBps !== undefined) {
    const bps = input.defaultGstRateBps;
    if (!Number.isInteger(bps) || bps < 0 || bps > 100_000) {
      throw new RangeError("GST rate must be a non-negative percentage.");
    }
    data.defaultGstRateBps = bps;
  }

  const defaultHsnCode = nullableTrim(input.defaultHsnCode);
  if (defaultHsnCode !== undefined) data.defaultHsnCode = defaultHsnCode;

  return prisma.sellerTaxProfile.upsert({
    where: { key: PROFILE_KEY },
    create: { key: PROFILE_KEY, ...data },
    update: data,
    select: PROFILE_SELECT,
  });
}
