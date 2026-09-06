"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { PERMISSIONS } from "@/lib/permissions";
import { MAX_MAINTENANCE_MESSAGE_CHARS } from "@/lib/maintenance";
import { updateMaintenance } from "@/server/services/maintenance";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin, isForbiddenError } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { writeAudit } from "@/server/security/audit";
import {
  updateCartNotice,
  InvalidCartNoticeError,
  InvalidMinOrderValueError,
  updateMinOrderValue,
  updateSlabyBranding,
  updateDeliveryRules,
} from "@/server/services/store-settings";
import { slabyBrandingSchema } from "@/lib/slaby/branding";
import { deliveryRulesSchema } from "@/lib/delivery";

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

const maintenanceInputSchema = z.object({
  enabled: z.boolean(),
  message: z.string().max(2000).nullable(),
  /** ISO instant, or null for "no time announced". */
  until: z.string().nullable(),
});

/**
 * Take the storefront down (or bring it back). The console itself is never
 * covered — see src/lib/maintenance.ts and the exempt list in src/proxy.ts.
 */
export async function saveMaintenanceAction(
  input: unknown,
): Promise<StoreSettingsResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const parsed = maintenanceInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
      };
    }

    const message = parsed.data.message?.trim() ?? "";
    if (message.length > MAX_MAINTENANCE_MESSAGE_CHARS) {
      return {
        ok: false,
        error: `The message can be at most ${MAX_MAINTENANCE_MESSAGE_CHARS} characters.`,
      };
    }

    // Normalise the return time to a real ISO instant; anything unparseable
    // is refused rather than quietly dropped — a wrong promise to customers
    // is worse than no promise.
    let until: string | null = null;
    if (parsed.data.until && parsed.data.until.trim() !== "") {
      const when = new Date(parsed.data.until);
      if (Number.isNaN(when.getTime())) {
        return { ok: false, error: "Enter a valid date and time." };
      }
      until = when.toISOString();
    }

    await updateMaintenance({
      enabled: parsed.data.enabled,
      message: message === "" ? null : message,
      until,
    });

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      // Taking the shop offline is the single most consequential toggle in
      // the console; it gets its own audit action, not a generic settings one.
      action: parsed.data.enabled
        ? "store_settings.maintenance_on"
        : "store_settings.maintenance_off",
      entity: "StoreSettings",
      entityId: "default",
      diff: { enabled: parsed.data.enabled, until },
    });

    revalidatePath(SETTINGS_PATH);
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    if (isForbiddenError(error)) {
      return {
        ok: false,
        error: "You don't have permission to manage store settings.",
      };
    }
    console.error("[actions/store-settings] maintenance error:", error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

const cartNoticeSchema = z.object({
  // Plain text; the service trims and treats empty as "clear".
  cartNotice: z.string().max(2000).nullable(),
});

/**
 * Save the cart notice (the owner's free-text copy under the cart's order
 * summary — e.g. which brands are billed WITH GST). Same guard pipeline as
 * every settings action above.
 */
export async function saveCartNoticeAction(
  input: unknown,
): Promise<StoreSettingsResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const parsed = cartNoticeSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
      };
    }

    const settings = await updateCartNotice(parsed.data.cartNotice);

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "store_settings.cart_notice",
      entity: "StoreSettings",
      entityId: settings.id,
      diff: { cartNotice: settings.cartNotice },
    });

    revalidatePath(SETTINGS_PATH);
    // The cart renders the notice server-side — refresh it.
    revalidatePath("/account/cart");
    return { ok: true };
  } catch (error) {
    if (isForbiddenError(error)) {
      return {
        ok: false,
        error: "You don't have permission to manage store settings.",
      };
    }
    if (error instanceof InvalidCartNoticeError) {
      return { ok: false, error: error.message };
    }
    console.error("[actions/store-settings] cart notice error:", error);
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

/**
 * Save the delivery rules (same guard pipeline). Cart + order surfaces read
 * the disclosure live; placed orders keep their frozen copy.
 */
export async function saveDeliveryRulesAction(
  input: unknown,
): Promise<StoreSettingsResult> {
  try {
    const viewer = await resolveViewer();
    assertAdmin(viewer);
    await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);

    const parsed = deliveryRulesSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "Invalid input.",
      };
    }

    const settings = await updateDeliveryRules(parsed.data);

    await writeAudit({
      actorType: "admin",
      actorId: viewer.adminId,
      action: "store_settings.deliveryRules",
      entity: "StoreSettings",
      entityId: settings.id,
      diff: parsed.data,
    });

    revalidatePath(SETTINGS_PATH);
    revalidatePath("/account/cart");
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
