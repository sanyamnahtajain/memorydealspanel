"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { minOrderableQty } from "@/lib/quantity";
import {
  addToCartAction,
  removeCartItemAction,
  updateCartQuantityAction,
  type CartActionResult,
} from "@/server/actions/cart";
import { broadcastCartCount } from "./CartBadge";
import { ensureCartLinesPrimed, setCartLineQty, useCartLineQty } from "./cart-lines-store";
import { hapticSuccess, hapticTap } from "@/lib/haptics";

/**
 * QuickAddToCart — Blinkit's card control: an outlined ADD button that, once
 * the product is in the cart, turns into a filled − qty + stepper right on
 * the card. Lives INSIDE a card `<Link>`, so every tap swallows the click.
 *
 * Quantities follow the trade rules the server enforces: ADD puts in the
 * pack-aligned minimum (MOQ), + and − move by the pack size, and stepping
 * below the minimum removes the line. The cart-lines store keeps every card
 * showing the same product in sync, and the cart badge / dock hear the new
 * item count.
 *
 * GATE: rendered ONLY for an approved customer on an in-stock, non-variant,
 * non-allocation product — the caller decides. It sends only ids and a
 * quantity; never a price. Access and price are re-checked server-side on
 * every call.
 */
export interface QuickAddToCartProps {
  productId: string;
  variantId?: string | null;
  /** MOQ floor — the quantity ADD puts in. Defaults to 1. */
  moq?: number | null;
  /** Pack multiple — the step for + and −. */
  packMultiple?: number | null;
  className?: string;
}

export function QuickAddToCart({
  productId,
  variantId = null,
  moq,
  packMultiple,
  className,
}: QuickAddToCartProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const inCart = useCartLineQty(productId, variantId);
  /** Shown while a change is in flight, so the number moves on the tap. */
  const [optimistic, setOptimistic] = React.useState<number | null>(null);
  const qty = pending && optimistic !== null ? optimistic : inCart;

  React.useEffect(() => {
    ensureCartLinesPrimed();
  }, []);

  const minQty = React.useMemo(() => minOrderableQty(moq, packMultiple), [moq, packMultiple]);
  const step = typeof packMultiple === "number" && packMultiple > 1 ? packMultiple : 1;

  function handle(result: CartActionResult) {
    if (result.ok) {
      broadcastCartCount(result.itemCount);
      setCartLineQty(productId, variantId, result.quantity);
      if (result.clamped) {
        toast.info(`Quantity set to ${result.quantity} (minimum order).`);
      }
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
  }

  function run(next: number, action: () => Promise<CartActionResult>, success = false) {
    hapticTap();
    setOptimistic(next);
    startTransition(async () => {
      const result = await action().catch(
        (): CartActionResult => ({ ok: false, reason: "error", message: "No connection. Please try again." }),
      );
      if (result.ok && success) hapticSuccess();
      handle(result);
    });
  }

  const ref = variantId ? { productId, variantId } : { productId };

  function add(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    run(minQty, () => addToCartAction({ ...ref, quantity: minQty }), true);
  }

  function increment(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = qty + step;
    run(next, () => updateCartQuantityAction({ ...ref, quantity: next }));
  }

  function decrement(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;
    const next = qty - step;
    if (next < minQty) {
      run(0, () => removeCartItemAction(ref));
    } else {
      run(next, () => updateCartQuantityAction({ ...ref, quantity: next }));
    }
  }

  if (qty <= 0) {
    return (
      <button
        type="button"
        aria-label="Add to cart"
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={add}
        className={cn(
          "inline-flex h-9 min-w-[4.25rem] items-center justify-center rounded-lg border border-primary bg-primary/[0.06] px-3 text-[13px] font-bold tracking-wide text-primary outline-none transition-[background-color,transform] duration-150 hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-95 disabled:opacity-70 md:h-8",
          className,
        )}
      >
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : "ADD"}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={`${qty} in cart`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className={cn(
        "inline-flex h-9 items-center rounded-lg bg-primary text-primary-foreground shadow-sm md:h-8",
        pending && "opacity-90",
        className,
      )}
    >
      <button
        type="button"
        aria-label={qty - step < minQty ? "Remove from cart" : "Decrease quantity"}
        onClick={decrement}
        className="inline-flex h-full w-8 items-center justify-center rounded-l-lg outline-none transition-colors hover:bg-black/10 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-black/15"
      >
        <Minus aria-hidden className="size-3.5" strokeWidth={3} />
      </button>
      <span aria-live="polite" className="min-w-6 flex-1 px-0.5 text-center font-tabular text-[13px] font-bold tabular-nums">
        {qty}
      </span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={increment}
        className="inline-flex h-full w-8 items-center justify-center rounded-r-lg outline-none transition-colors hover:bg-black/10 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-black/15"
      >
        <Plus aria-hidden className="size-3.5" strokeWidth={3} />
      </button>
    </div>
  );
}
