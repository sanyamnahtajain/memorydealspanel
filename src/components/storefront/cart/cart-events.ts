"use client";

/**
 * Cart line events — a tiny window-event bus (same pattern as CartBadge's
 * count broadcast) so decoupled PDP widgets can react to "this product was
 * just added". Used by RequirementPrompt to auto-open the note/photo sheet
 * right after an add on products that allow requirement notes.
 */

export const CART_LINE_ADDED_EVENT = "md:cart:line-added";

export interface CartLineAddedDetail {
  productId: string;
  variantId: string | null;
}

export function broadcastLineAdded(
  productId: string,
  variantId: string | null = null,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<CartLineAddedDetail>(CART_LINE_ADDED_EVENT, {
      detail: { productId, variantId },
    }),
  );
}
