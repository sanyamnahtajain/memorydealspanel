"use server";

import { revalidatePath } from "next/cache";
import { resolveViewer } from "@/server/auth/viewer";
import { assertAdmin } from "@/server/dal/guard";
import { assertPermission } from "@/server/auth/require-permission";
import { PERMISSIONS } from "@/lib/permissions";
import { writeAudit } from "@/server/security/audit";
import { isCustomer, canSeePrices } from "@/server/types/viewer";
import { priceCartForCustomer } from "@/server/services/orders";
import {
  createCoupon,
  updateCoupon,
  softDeleteCoupon,
  listCoupons,
  previewCoupon,
  suggestCoupons,
  COUPON_FAIL_COPY,
  type CouponSuggestion,
  type CouponDTO,
  type CreateCouponInput,
  type UpdateCouponInput,
} from "@/server/services/coupons";

/**
 * Coupon actions — the admin CRUD (SETTINGS_MANAGE-gated, mirroring the other
 * store-wide commerce knobs) and the storefront preview (customer-gated; the
 * subtotal is ALWAYS the server-priced cart, never a client number).
 */

export type CouponActionResult =
  | { ok: true; coupon: CouponDTO }
  | { ok: false; error: string };

export async function createCouponAction(
  input: CreateCouponInput,
): Promise<CouponActionResult> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);
  await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);
  const result = await createCoupon(input);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "CODE_TAKEN"
          ? "A coupon with that code already exists."
          : (result.message ?? "Couldn't create the coupon."),
    };
  }
  await writeAudit({
    actorType: "admin",
    actorId: viewer.adminId,
    action: "coupon.create",
    entity: "Coupon",
    entityId: result.coupon.id,
    diff: { code: result.coupon.code },
  });
  revalidatePath("/admin/coupons");
  return { ok: true, coupon: result.coupon };
}

export async function updateCouponAction(
  id: string,
  patch: UpdateCouponInput,
): Promise<CouponActionResult> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);
  await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);
  const result = await updateCoupon(id, patch);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "NOT_FOUND"
          ? "This coupon no longer exists."
          : (result.message ?? "Couldn't update the coupon."),
    };
  }
  await writeAudit({
    actorType: "admin",
    actorId: viewer.adminId,
    action: "coupon.update",
    entity: "Coupon",
    entityId: result.coupon.id,
    diff: { code: result.coupon.code },
  });
  revalidatePath("/admin/coupons");
  return { ok: true, coupon: result.coupon };
}

export async function deleteCouponAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);
  await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);
  const result = await softDeleteCoupon(id);
  if (!result.ok) return { ok: false, error: "This coupon no longer exists." };
  await writeAudit({
    actorType: "admin",
    actorId: viewer.adminId,
    action: "coupon.delete",
    entity: "Coupon",
    entityId: id,
  });
  revalidatePath("/admin/coupons");
  return { ok: true };
}

export async function listCouponsAction(): Promise<
  { ok: true; coupons: CouponDTO[] } | { ok: false; error: string }
> {
  const viewer = await resolveViewer();
  assertAdmin(viewer);
  await assertPermission(viewer, PERMISSIONS.SETTINGS_MANAGE);
  return { ok: true, coupons: await listCoupons() };
}

/**
 * Storefront preview: would this code apply to MY cart right now, and for how
 * much? The subtotal comes from the server-priced cart — a client can never
 * inflate it. Never claims a redemption; placement is the authority.
 */
export async function previewCouponAction(code: string): Promise<
  | { ok: true; code: string; discountPaise: number }
  | { ok: false; message: string }
> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer) || !canSeePrices(viewer)) {
    return { ok: false, message: "Sign in with an approved account to use codes." };
  }
  const cart = await priceCartForCustomer(viewer.customerId);
  if (cart.orderableLines.length === 0) {
    return { ok: false, message: "Add items to your cart first." };
  }
  const quote = await previewCoupon(
    code,
    cart.orderableLines.map((l) => ({
      productId: l.productId,
      lineTotalPaise: l.lineTotalPaise,
    })),
  );
  if (!quote.ok) return { ok: false, message: COUPON_FAIL_COPY[quote.reason] };
  return { ok: true, code: quote.code, discountPaise: quote.discountPaise };
}

/** A suggestion serialized for the cart UI, with display-ready copy. */
export interface CouponSuggestionDTO extends CouponSuggestion {
  /** Why it doesn't apply, as friendly copy (null when applicable). */
  reasonMessage: string | null;
}

/**
 * The coupons worth showing on the customer's cart, quoted against the live
 * server-priced lines: applicable first, then the almost-applicable with the
 * reason. Bounded; never claims a redemption.
 */
export async function suggestCouponsAction(): Promise<
  { ok: true; suggestions: CouponSuggestionDTO[] } | { ok: false }
> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer) || !canSeePrices(viewer)) return { ok: false };
  const cart = await priceCartForCustomer(viewer.customerId);
  if (cart.orderableLines.length === 0) return { ok: true, suggestions: [] };
  const suggestions = await suggestCoupons(
    cart.orderableLines.map((l) => ({
      productId: l.productId,
      lineTotalPaise: l.lineTotalPaise,
    })),
    viewer.customerId,
  );
  return {
    ok: true,
    suggestions: suggestions.map((sug) => ({
      ...sug,
      reasonMessage: sug.reason ? COUPON_FAIL_COPY[sug.reason] : null,
    })),
  };
}
