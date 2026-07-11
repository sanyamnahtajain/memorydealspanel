"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Minus, Plus, ShoppingCart, Lock } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { springs } from "@/components/motion/tokens";
import { cn } from "@/lib/utils";
import { MAX_QTY_PER_LINE, MIN_QTY_PER_LINE } from "@/lib/schemas/cart";
import { addToCartAction } from "@/server/actions/cart";
import { broadcastCartCount } from "./CartBadge";

/**
 * AddToCartButton — the storefront add-to-cart control: a quantity stepper
 * (respecting the product's MOQ floor and the per-line cap) plus an "Add to
 * cart" button. Optimistic: it broadcasts the new cart count immediately and
 * reconciles with the server's authoritative count on response.
 *
 * GATE: only an APPROVED customer (`canAdd`) sees the working control. Everyone
 * else sees a locked affordance that routes to login (anonymous) or the
 * request-access flow (a logged-in-but-unapproved customer) — the cart, like
 * prices, is unlocked only on approval. The client NEVER sends a price; it
 * sends only { productId, variantId?, quantity }.
 */

export interface AddToCartButtonProps {
  productId: string;
  /** Present only when a specific variant is selected. */
  variantId?: string | null;
  /** The product/variant MOQ — the stepper's floor. Defaults to 1. */
  moq?: number | null;
  /** Whether this viewer may add to cart (APPROVED). */
  canAdd: boolean;
  /**
   * Whether the viewer is a logged-in (but unapproved) customer. Drives where
   * the locked affordance routes: request-access vs. login.
   */
  isCustomer?: boolean;
  /** OUT_OF_STOCK blocks adding entirely. */
  outOfStock?: boolean;
  /** Full-width sticky CTA on mobile by default. */
  fullWidth?: boolean;
  className?: string;
}

/** Clamp a candidate quantity into the [floor, cap] window. */
function clamp(value: number, floor: number): number {
  if (!Number.isFinite(value)) return floor;
  return Math.min(MAX_QTY_PER_LINE, Math.max(floor, Math.trunc(value)));
}

export function AddToCartButton({
  productId,
  variantId = null,
  moq,
  canAdd,
  isCustomer = false,
  outOfStock = false,
  fullWidth = true,
  className,
}: AddToCartButtonProps) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const floor = React.useMemo(() => {
    const m = typeof moq === "number" && moq >= MIN_QTY_PER_LINE ? Math.trunc(moq) : MIN_QTY_PER_LINE;
    return Math.min(MAX_QTY_PER_LINE, m);
  }, [moq]);

  const [qty, setQty] = React.useState(floor);
  const [pending, startTransition] = React.useTransition();

  // Re-seed the quantity to the floor when the MOQ changes (e.g. variant swap).
  const [seenFloor, setSeenFloor] = React.useState(floor);
  if (seenFloor !== floor) {
    setSeenFloor(floor);
    setQty(floor);
  }

  // ---- Locked / gated affordance ------------------------------------------
  if (!canAdd) {
    const label = isCustomer ? "Approval required to order" : "Sign in to order";
    return (
      <Tooltip content={isCustomer ? "Your account is awaiting approval" : "Sign in and get approved to place orders"}>
        <Button
          type="button"
          size="lg"
          variant="outline"
          onClick={() =>
            router.push(isCustomer ? "/account?request=1" : "/account/login")
          }
          className={cn("h-11 gap-2", fullWidth && "w-full", className)}
        >
          <Lock aria-hidden className="size-4" />
          {label}
        </Button>
      </Tooltip>
    );
  }

  // ---- Out of stock --------------------------------------------------------
  if (outOfStock) {
    return (
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled
        className={cn("h-11 gap-2", fullWidth && "w-full", className)}
      >
        <ShoppingCart aria-hidden className="size-4" />
        Out of stock
      </Button>
    );
  }

  const canDecrement = qty > floor && !pending;
  const canIncrement = qty < MAX_QTY_PER_LINE && !pending;

  function step(delta: number) {
    setQty((q) => clamp(q + delta, floor));
  }

  function onInputChange(raw: string) {
    if (raw.trim() === "") {
      setQty(floor);
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) return;
    setQty(clamp(parsed, floor));
  }

  function handleAdd() {
    if (pending) return;
    const quantity = clamp(qty, floor);

    startTransition(async () => {
      const result = await addToCartAction({
        productId,
        ...(variantId ? { variantId } : {}),
        quantity,
      });

      if (result.ok) {
        broadcastCartCount(result.itemCount);
        toast.success(
          result.clamped
            ? `Added — quantity adjusted to ${result.quantity} (minimum order).`
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
  }

  return (
    <div className={cn("flex items-center gap-2", fullWidth && "w-full", className)}>
      {/* Quantity stepper — a fully custom control (no native number spinner). */}
      <div
        role="group"
        aria-label="Quantity"
        className="inline-flex h-11 items-center rounded-lg border border-border bg-background"
      >
        <Tooltip content={floor > 1 ? `Minimum order is ${floor}` : "Decrease"}>
          <button
            type="button"
            aria-label="Decrease quantity"
            disabled={!canDecrement}
            onClick={() => step(-1)}
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-l-lg text-muted-foreground",
              "transition-colors outline-none hover:bg-muted hover:text-foreground",
              "focus-visible:ring-3 focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <Minus aria-hidden className="size-4" />
          </button>
        </Tooltip>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          aria-label="Quantity"
          value={qty}
          onChange={(e) => onInputChange(e.target.value)}
          onBlur={() => setQty((q) => clamp(q, floor))}
          className={cn(
            "h-full w-12 border-x border-border bg-transparent text-center text-sm font-medium tabular-nums",
            "outline-none focus-visible:bg-muted/40",
          )}
        />
        <Tooltip content="Increase">
          <button
            type="button"
            aria-label="Increase quantity"
            disabled={!canIncrement}
            onClick={() => step(1)}
            className={cn(
              "inline-flex size-11 items-center justify-center rounded-r-lg text-muted-foreground",
              "transition-colors outline-none hover:bg-muted hover:text-foreground",
              "focus-visible:ring-3 focus-visible:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            <Plus aria-hidden className="size-4" />
          </button>
        </Tooltip>
      </div>

      <motion.div
        className={cn(fullWidth && "flex-1")}
        whileTap={reduced || pending ? undefined : { scale: 0.98 }}
        transition={springs.snappy}
      >
        <Button
          type="button"
          size="lg"
          variant="default"
          aria-busy={pending || undefined}
          disabled={pending}
          onClick={handleAdd}
          className={cn("h-11 gap-2", fullWidth && "w-full")}
        >
          <ShoppingCart aria-hidden className="size-4" />
          {pending ? "Adding…" : "Add to cart"}
        </Button>
      </motion.div>
    </div>
  );
}
