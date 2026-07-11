"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import { MAX_CART_NOTE_LENGTH } from "@/lib/schemas/cart";
import {
  placeOrder,
  type PlaceOrderResult,
  type PricedCartLine,
} from "@/server/services/orders";

/**
 * Order server actions — the transport seam for placing an order.
 *
 * SECURITY (see services/orders.ts for the full invariant list):
 *  - The customer id is taken EXCLUSIVELY from `resolveViewer()`; no action
 *    accepts a customerId, so a caller can only ever place from their OWN cart.
 *  - `canSeePrices(viewer)` is re-checked here as a fast gate; the service
 *    re-verifies the live grant transactionally, so a stale session can't slip
 *    an order through.
 *  - The client sends ONLY `{ note?, idempotencyKey? }` — never any price or
 *    line data. The order is priced entirely server-side from the stored cart.
 *
 * A "use server" module may only export async functions — every schema/const is
 * module-internal.
 */

const placeOrderSchema = z.object({
  note: z.string().max(MAX_CART_NOTE_LENGTH).optional(),
  idempotencyKey: z.string().min(1).max(100).optional(),
});

/** The typed failure reasons a placement can return. */
export type PlaceOrderErrorCode = "empty" | "access" | "rate-limit" | "too-large";

/** Client-facing result: the order number on success, or a typed failure. */
export type PlaceOrderActionResult =
  | { ok: true; orderNumber: string; deduped: boolean; excludedCount: number }
  | { ok: false; needsLogin: true }
  | {
      ok: false;
      needsLogin?: false;
      error: PlaceOrderErrorCode;
      message: string;
      excludedCount?: number;
    };

/**
 * Place the current customer's cart as an order (a purchase request). Returns
 * the random order number for the confirmation page. Anonymous/admin viewers,
 * or customers who have lost price access, are refused.
 */
export async function placeOrderAction(
  input: { note?: string; idempotencyKey?: string } = {},
): Promise<PlaceOrderActionResult> {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    return { ok: false, needsLogin: true };
  }
  if (!canSeePrices(viewer)) {
    return {
      ok: false,
      error: "access",
      message: "Your account cannot place orders right now.",
    };
  }

  const parsed = placeOrderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "empty",
      message: parsed.error.issues[0]?.message ?? "Invalid order.",
    };
  }

  let result: PlaceOrderResult;
  try {
    result = await placeOrder(viewer.customerId, parsed.data);
  } catch (error) {
    console.error("[actions/orders] placeOrder failed:", error);
    return {
      ok: false,
      error: "empty",
      message: "Something went wrong placing your order. Please try again.",
    };
  }

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      message: result.message,
      excludedCount: result.excluded?.length ?? 0,
    };
  }

  // The cart is now empty; refresh cart-bearing surfaces.
  revalidatePath("/account/cart");
  revalidatePath("/account");

  return {
    ok: true,
    orderNumber: result.order.orderNumber,
    deduped: result.deduped,
    excludedCount: result.excluded.length,
  };
}

/** Re-export the priced-line type for the cart UI (client-safe, no secrets). */
export type { PricedCartLine };
