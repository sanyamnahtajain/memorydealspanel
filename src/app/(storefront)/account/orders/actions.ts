"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import { writeAudit } from "@/server/security/audit";
import { limit } from "@/server/security/ratelimit";
import { addToCart, CartError } from "@/server/services/cart";
import { parseOrderItems } from "@/server/services/admin-orders";

/**
 * Customer order-history actions — REORDER and CANCEL. These live under the
 * account/orders route (co-located, like search/actions.ts) rather than in the
 * admin actions module, because they are BUYER-scoped, not admin-scoped.
 *
 * ============================ ANTI-CHEAT CORE ============================
 * 1. IDOR: the customer id ALWAYS comes from `resolveViewer()` — never from
 *    the request. The order is looked up by { customerId, orderNumber }, so a
 *    buyer can only ever act on THEIR OWN order, even with a guessed number.
 * 2. ACCESS re-checked on every mutation: reorder requires a price-authorised
 *    (APPROVED + live grant) viewer — re-verified here AND again inside
 *    `addToCart`. A lapsed/blocked customer cannot reorder.
 * 3. PRICE NEVER TRUSTED: reorder sends only { productId, variantId?, quantity }
 *    to the gated cart service, which re-resolves the LIVE entitled price and
 *    re-validates availability/MOQ. The frozen order snapshot price is NOT
 *    reused — a reorder is priced fresh at (eventual) placement.
 * 4. RATE LIMITED: both actions are throttled per customer.
 * 5. CANCEL is only permitted while the order is still PLACED (before the
 *    wholesaler CONFIRMS) — a status guard in the atomic update prevents a
 *    race from cancelling a confirmed/fulfilled order.
 * ========================================================================
 */

export type ActionResult<T = Record<string, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

const orderNumberSchema = z.string().trim().min(4).max(64);

/** Reorder: 10 per hour per customer. Cancel: 20 per hour per customer. */
const REORDER_LIMIT = { points: 10, window: 3600 } as const;
const CANCEL_LIMIT = { points: 20, window: 3600 } as const;

/* ------------------------------------------------------------------ */
/* Reorder — re-add every still-available line to the cart            */
/* ------------------------------------------------------------------ */

export interface ReorderResult {
  /** Lines successfully (re-)added to the cart. */
  added: number;
  /** Lines skipped because the product/variant is no longer orderable. */
  skipped: number;
  /** Fresh distinct-line count of the cart after the reorder. */
  lineCount: number;
}

/**
 * Re-add the items of a past order to the current cart. Ownership + access are
 * re-checked; each line is routed through the gated `addToCart`, which
 * re-validates the live product/variant, clamps to the current MOQ, and never
 * trusts the snapshot price. Unavailable lines (pulled product, removed
 * variant, out of stock) are SKIPPED, never silently ordered.
 */
export async function reorderAction(
  orderNumber: string,
): Promise<ActionResult<ReorderResult>> {
  try {
    const viewer = await resolveViewer();
    if (!isCustomer(viewer)) {
      return { ok: false, error: "Please sign in to reorder." };
    }
    if (!canSeePrices(viewer)) {
      return {
        ok: false,
        error: "Your account isn't approved to place orders right now.",
      };
    }

    const number = orderNumberSchema.parse(orderNumber);

    const throttle = await limit(viewer.customerId, REORDER_LIMIT, "reorder");
    if (!throttle.ok) {
      return { ok: false, error: "Too many reorders. Please try again later." };
    }

    // IDOR gate: scope by customerId + orderNumber.
    const order = await prisma.order.findFirst({
      where: { customerId: viewer.customerId, orderNumber: number },
      select: { id: true, items: true },
    });
    if (!order) {
      return { ok: false, error: "Order not found." };
    }

    const items = parseOrderItems(order.items);
    let added = 0;
    let skipped = 0;

    for (const item of items) {
      try {
        await addToCart(viewer, {
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
        });
        added += 1;
      } catch (error) {
        // A line that can't be re-added (pulled/out-of-stock/variant removed)
        // is skipped — the cart never silently gains an unorderable line.
        if (error instanceof CartError) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }

    const lineCount = await prisma.cartItem.count({
      where: { customerId: viewer.customerId },
    });

    await writeAudit({
      actorType: "customer",
      actorId: viewer.customerId,
      action: "order.reorder",
      entity: "Order",
      entityId: order.id,
      diff: { added, skipped },
    });

    revalidatePath("/account/cart");
    revalidatePath("/account/orders");

    if (added === 0) {
      return {
        ok: false,
        error:
          skipped > 0
            ? "None of these items are available to order right now."
            : "This order has no items to reorder.",
      };
    }
    return { ok: true, added, skipped, lineCount };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: "Invalid order reference." };
    }
    console.error("[actions/orders] reorder failed:", error);
    return { ok: false, error: "Couldn't reorder. Please try again." };
  }
}

/* ------------------------------------------------------------------ */
/* Cancel — only while still PLACED (before the wholesaler confirms)  */
/* ------------------------------------------------------------------ */

/**
 * Cancel an order the buyer placed, permitted ONLY while it is still `PLACED`
 * (i.e. before the wholesaler CONFIRMS it). Ownership is enforced by scoping
 * `updateMany` to { id, customerId, status: PLACED } — an order that has moved
 * on, or belongs to someone else, matches zero rows and the action reports it
 * can no longer be cancelled. This closes the two-tab / confirm-race window.
 */
export async function cancelOrderAction(
  orderNumber: string,
): Promise<ActionResult<{ orderNumber: string }>> {
  try {
    const viewer = await resolveViewer();
    if (!isCustomer(viewer)) {
      return { ok: false, error: "Please sign in to manage your orders." };
    }

    const number = orderNumberSchema.parse(orderNumber);

    const throttle = await limit(viewer.customerId, CANCEL_LIMIT, "order-cancel");
    if (!throttle.ok) {
      return { ok: false, error: "Too many attempts. Please try again later." };
    }

    // Look up (ownership-scoped) so we can distinguish "not yours / missing"
    // from "already progressed" for a clear message.
    const order = await prisma.order.findFirst({
      where: { customerId: viewer.customerId, orderNumber: number },
      select: { id: true, status: true },
    });
    if (!order) {
      return { ok: false, error: "Order not found." };
    }
    if (order.status !== "PLACED") {
      return {
        ok: false,
        error:
          order.status === "CANCELLED"
            ? "This order is already cancelled."
            : "This order is being processed and can no longer be cancelled.",
      };
    }

    // Atomic, race-safe transition: only flips a row that is STILL PLACED.
    const result = await prisma.order.updateMany({
      where: { id: order.id, customerId: viewer.customerId, status: "PLACED" },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) {
      return {
        ok: false,
        error: "This order can no longer be cancelled.",
      };
    }

    // Let the admin queue know a placed order was withdrawn.
    await prisma.notification
      .create({
        data: {
          type: "order.cancelledByCustomer",
          payload: {
            orderId: order.id,
            orderNumber: number,
            customerId: viewer.customerId,
          },
        },
      })
      .catch((error) => {
        console.error("[actions/orders] cancel notify failed:", error);
      });

    await writeAudit({
      actorType: "customer",
      actorId: viewer.customerId,
      action: "order.cancel",
      entity: "Order",
      entityId: order.id,
    });

    revalidatePath("/account/orders");
    revalidatePath(`/account/orders/${number}`);
    revalidatePath("/admin/orders");
    return { ok: true, orderNumber: number };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, error: "Invalid order reference." };
    }
    console.error("[actions/orders] cancel failed:", error);
    return { ok: false, error: "Couldn't cancel the order. Please try again." };
  }
}
