"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PERMISSIONS } from "@/lib/permissions";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { writeAudit } from "@/server/security/audit";
import {
  updateSellerTaxProfile,
  InvalidGstinError,
  InvalidStateCodeError,
} from "@/server/services/tax-profile";
import {
  taxProfileFormSchema,
  type TaxSettingsResult,
} from "@/server/actions/tax-settings-schema";
import {
  setGstViewPreference,
  type GstView,
} from "@/server/prefs/gst-view";

/**
 * Tax-settings server actions — thin transport wrappers.
 *
 * `saveTaxProfileAction` follows the standard admin mutation pipeline:
 *   assertAdmin → assertPermission(settings.tax.manage) → zod → service →
 *   audit → revalidate. It never throws across the client boundary; failures
 *   return a typed `{ ok: false, error }`.
 *
 * `setGstViewAction` is a low-stakes per-browser UI preference (which display
 * mode the retailer sees) and only writes a cookie — no auth needed.
 *
 * This file is "use server"; per the server-actions loader it may export ONLY
 * async functions. Schemas/types live in `./tax-settings-schema`.
 */

const TAX_SETTINGS_PATH = "/admin/settings/tax";

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input.";
}

/**
 * Upserts the seller GST/tax profile. The percentage the form sends is
 * converted to basis points here (server-authoritative) before persistence.
 */
export async function saveTaxProfileAction(
  input: unknown,
): Promise<TaxSettingsResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_TAX_MANAGE);

    const parsed = taxProfileFormSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: firstIssue(parsed.error) };
    }
    const d = parsed.data;

    const profile = await updateSellerTaxProfile({
      gstEnabled: d.gstEnabled,
      gstin: d.gstin ?? null,
      legalName: d.legalName ?? null,
      stateCode: d.stateCode ?? null,
      priceEntryMode: d.priceEntryMode,
      displayMode: d.displayMode,
      roundingMode: d.roundingMode,
      // percent → basis points (18 → 1800), integer-exact.
      defaultGstRateBps: Math.round(d.defaultGstRatePercent * 100),
      defaultHsnCode: d.defaultHsnCode ?? null,
    });

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "tax_profile.update",
      entity: "SellerTaxProfile",
      entityId: profile.id,
      diff: {
        gstEnabled: profile.gstEnabled,
        gstin: profile.gstin,
        stateCode: profile.stateCode,
        priceEntryMode: profile.priceEntryMode,
        displayMode: profile.displayMode,
        roundingMode: profile.roundingMode,
        defaultGstRateBps: profile.defaultGstRateBps,
        defaultHsnCode: profile.defaultHsnCode,
      },
    });

    revalidatePath(TAX_SETTINGS_PATH);
    return { ok: true };
  } catch (error) {
    if (isForbiddenError(error)) {
      return { ok: false, error: "You don't have permission to manage tax settings." };
    }
    if (error instanceof InvalidGstinError || error instanceof InvalidStateCodeError) {
      return { ok: false, error: error.message };
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not save tax settings.",
    };
  }
}

/**
 * Persists the retailer's GST display preference (inclusive / exclusive) as a
 * cookie. Returns quietly on success; invalid values are ignored by the helper.
 */
export async function setGstViewAction(view: GstView): Promise<{ ok: true }> {
  await setGstViewPreference(view);
  return { ok: true };
}
