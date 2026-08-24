"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PERMISSIONS } from "@/lib/permissions";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { writeAudit } from "@/server/security/audit";
import {
  InvalidMinOrderValueError,
  updateMinOrderValue,
  updateSlabyBranding,
} from "@/server/services/store-settings";
import { slabyBrandingSchema } from "@/lib/slaby/branding";

/**
 * Store-settings server actions (order-flow configuration).
 *
 * Contract (matches tax-settings): resolveViewer → assertAdmin →
 * assertPermission(settings.manage) → zod → service → writeAudit →
 * revalidatePath. Failures come back as `{ ok: false, error }` — nothing
 * throws to the client.
 */

export type StoreSettingsResult = { ok: true } | { ok: false; error: string };

const SETTINGS_PATH = "/admin/settings";

/**
 * The form sends the minimum order value in integer PAISE (parsed client-side
 * from the rupee text via lib/money), or null to disable the minimum. Range
 * validation against the max-order ceiling lives in the service.
 */
const storeSettingsFormSchema = z.object({
  minOrderValuePaise: z
    .number()
    .int()
    .min(0)
    .nullable(),
});

export async function saveStoreSettingsAction(
  input: unknown,
): Promise<StoreSettingsResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const parsed = storeSettingsFormSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
      };
    }

    const settings = await updateMinOrderValue(
      parsed.data.minOrderValuePaise,
    );

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "store_settings.update",
      entity: "StoreSettings",
      entityId: settings.id,
      diff: { minOrderValuePaise: settings.minOrderValuePaise },
    });

    revalidatePath(SETTINGS_PATH);
    // The cart shows the shortfall banner — refresh it too.
    revalidatePath("/account/cart");
    return { ok: true };
  } catch (error) {
    if (isForbiddenError(error)) {
      return {
        ok: false,
        error: "You don't have permission to manage store settings.",
      };
    }
    if (error instanceof InvalidMinOrderValueError) {
      return { ok: false, error: error.message };
    }
    console.error("[actions/store-settings] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

/**
 * Save the "Built with Slaby" branding placements (same guard pipeline as
 * the store settings above). The public /api/slaby-branding read is fresh on
 * the next request; storefront pages that render the badge server-side are
 * revalidated explicitly.
 */
export async function saveSlabyBrandingAction(
  input: unknown,
): Promise<StoreSettingsResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const parsed = slabyBrandingSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
      };
    }

    const settings = await updateSlabyBranding(parsed.data);

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "store_settings.slabyBranding",
      entity: "StoreSettings",
      entityId: settings.id,
      diff: parsed.data,
    });

    revalidatePath(SETTINGS_PATH);
    revalidatePath("/account/login");
    revalidatePath("/account/orders/confirmation");
    return { ok: true };
  } catch (error) {
    if (isForbiddenError(error)) {
      return {
        ok: false,
        error: "You don't have permission to manage store settings.",
      };
    }
    console.error("[actions/store-settings] unexpected error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
