"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { clampQuantity, normalisePack } from "@/lib/quantity";
import { addToCartAction } from "@/server/actions/cart";
import { broadcastCartCount } from "./CartBadge";
import { broadcastLineAdded } from "./cart-events";
import { setCartLineQty } from "./cart-lines-store";

/**
 * useAddToCart — THE client add-to-cart flow, extracted verbatim from
 * {@link import("./AddToCartButton").AddToCartButton} so every surface that
 * adds a line (the PDP stepper, the sticky mobile bar) behaves identically:
 * the same server action, the same shared clamp, the same success / clamped
 * toasts with their "View cart" action, the same cart-count + line-added
 * broadcasts, and the same refusal routing (login / approval / error toast).
 *
 * GATE: callers render an add control only for viewers who may add — and the
 * server re-checks access on every call regardless. The client sends ONLY
 * `{ productId, variantId?, quantity }`; never a price.
 */
export interface UseAddToCartOptions {
  productId: string;
  /** Present only when a specific variant is being added. */
  variantId?: string | null;
  /** The product/variant MOQ — the clamp's floor input. */
  moq?: number | null;
  /** Order in multiples of this (boxes). null/1 = any quantity. */
  packMultiple?: number | null;
}

export interface UseAddToCartResult {
  /** True while the server round-trip is in flight. */
  pending: boolean;
  /** Clamp `rawQuantity` (shared clamp) and add it to the cart. */
  add: (rawQuantity: number) => void;
}

export function useAddToCart({
  productId,
  variantId = null,
  moq,
  packMultiple,
}: UseAddToCartOptions): UseAddToCartResult {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const pack = normalisePack(packMultiple);

  const add = React.useCallback(
    (rawQuantity: number) => {
      if (pending) return;
      const quantity = clampQuantity(rawQuantity, moq, packMultiple);

      startTransition(async () => {
        const result = await addToCartAction({
          productId,
          ...(variantId ? { variantId } : {}),
          quantity,
        });

        if (result.ok) {
          broadcastCartCount(result.itemCount);
          broadcastLineAdded(productId, variantId);
          setCartLineQty(productId, variantId, result.quantity);
          toast.success(
            result.clamped
              ? pack > 1
                ? `Added — quantity adjusted to ${result.quantity} (packs of ${pack}).`
                : `Added — quantity adjusted to ${result.quantity} (minimum order).`
              : "Added to cart.",
            {
              action: {
                label: "View cart",
                onClick: () => router.push("/account/cart"),
              },
            },
          );
          return;
        }

        switch (result.reason) {
          case "needs-login":
            toast.info(result.message);
            router.push("/account/login");
            break;
          case "needs-approval":
            toast.info(result.message);
            router.push("/account?request=1");
            break;
          default:
            toast.error(result.message);
        }
      });
    },
    [pending, productId, variantId, moq, packMultiple, pack, router],
  );

  return { pending, add };
}
