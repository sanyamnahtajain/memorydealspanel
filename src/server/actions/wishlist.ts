"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { isCustomer } from "@/server/types/viewer";
import { objectIdSchema } from "@/lib/schemas/shared";
import {
  removeFromWishlist,
  toggleWishlist,
  wishlistCount,
  WishlistProductError,
} from "@/server/services/wishlist";

/**
 * Wishlist server actions — the transport seam between the storefront heart and
 * the per-customer wishlist service.
 *
 * SECURITY: the customer id is taken EXCLUSIVELY from `resolveViewer()`. No
 * action accepts a customerId from the client, so a caller can only ever mutate
 * their OWN list (IDOR-proof by construction). Only a logged-in customer may
 * wishlist — an anonymous viewer gets a typed `{ needsLogin: true }` so the
 * client can route to `/account/login` instead of silently failing. Admins are
 * not customers and have no personal wishlist, so they are treated as
 * "not a customer" here too.
 *
 * A "use server" module may only export async functions — every schema/const is
 * module-internal.
 */

/** Result shape for a wishlist mutation. */
export type WishlistActionResult =
  | { ok: true; saved: boolean; count: number }
  | { ok: false; needsLogin: true }
  | { ok: false; needsLogin?: false; error: string };

const productIdSchema = z.object({ productId: objectIdSchema });

/** Storefront paths whose gated/count-bearing UI may reflect wishlist state. */
function revalidateWishlist(): void {
  revalidatePath("/account/wishlist");
}

/**
 * Toggle a product in the current customer's wishlist. Returns the resulting
 * saved state plus the fresh saved-count so the header badge can update in one
 * round trip. Anonymous viewers get `needsLogin`.
 */
export async function toggleWishlistAction(
  productId: string,
): Promise<WishlistActionResult> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    return { ok: false, needsLogin: true };
  }

  const parsed = productIdSchema.safeParse({ productId });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid product.",
    };
  }

  try {
    const { saved } = await toggleWishlist(
      viewer.customerId,
      parsed.data.productId,
    );
    const count = await wishlistCount(viewer.customerId);
    revalidateWishlist();
    return { ok: true, saved, count };
  } catch (error) {
    if (error instanceof WishlistProductError) {
      return { ok: false, error: error.message };
    }
    console.error("[actions/wishlist] toggle failed:", error);
    return { ok: false, error: "Could not update your wishlist." };
  }
}

/**
 * Remove a product from the current customer's wishlist (used by the wishlist
 * page's explicit remove control). Idempotent. Anonymous viewers get
 * `needsLogin`.
 */
export async function removeWishlistAction(
  productId: string,
): Promise<WishlistActionResult> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    return { ok: false, needsLogin: true };
  }

  const parsed = productIdSchema.safeParse({ productId });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid product.",
    };
  }

  try {
    await removeFromWishlist(viewer.customerId, parsed.data.productId);
    const count = await wishlistCount(viewer.customerId);
    revalidateWishlist();
    return { ok: true, saved: false, count };
  } catch (error) {
    console.error("[actions/wishlist] remove failed:", error);
    return { ok: false, error: "Could not update your wishlist." };
  }
}
