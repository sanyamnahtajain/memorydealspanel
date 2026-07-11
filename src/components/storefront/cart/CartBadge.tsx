"use client";

import * as React from "react";
import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Tooltip } from "@/components/ui/tooltip";
import { springs } from "@/components/motion/tokens";
import { cn } from "@/lib/utils";

/**
 * CartBadge — the header / bottom-tab entry point to the cart, with a live
 * item-count bubble. It renders a cart icon that links to `/account/cart`; the
 * bubble appears only when the cart holds at least one unit.
 *
 * The count is seeded from the server (`initialCount`, the sum of units across
 * lines) and kept fresh optimistically WITHOUT a round trip: any component
 * (e.g. AddToCartButton) broadcasts the new count via
 * `broadcastCartCount(n)`. Only mounted for an APPROVED customer — a guest or
 * a non-approved customer has no cart, so the shell never renders this.
 */

/** DOM event name the badge listens on for optimistic count updates. */
export const CART_COUNT_EVENT = "cart:count";

/**
 * Broadcast a new cart item-count so every mounted {@link CartBadge} updates
 * immediately. Call after a successful add / update / remove.
 */
export function broadcastCartCount(count: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CART_COUNT_EVENT, { detail: count }));
}

export interface CartBadgeProps {
  /** Server-hydrated item count (sum of units across lines). */
  initialCount?: number;
  /** Href of the cart page. */
  href?: string;
  className?: string;
}

export function CartBadge({
  initialCount = 0,
  href = "/account/cart",
  className,
}: CartBadgeProps) {
  const reduced = useReducedMotion();
  const [count, setCount] = React.useState(initialCount);

  // Re-seed from the server prop during render (React-recommended) rather than
  // in an effect, avoiding a cascading render when the header refreshes.
  const [seenInitial, setSeenInitial] = React.useState(initialCount);
  if (seenInitial !== initialCount) {
    setSeenInitial(initialCount);
    setCount(initialCount);
  }

  React.useEffect(() => {
    function onCount(event: Event) {
      const detail = (event as CustomEvent<number>).detail;
      if (typeof detail === "number" && Number.isFinite(detail)) {
        setCount(Math.max(0, Math.trunc(detail)));
      }
    }
    window.addEventListener(CART_COUNT_EVENT, onCount);
    return () => window.removeEventListener(CART_COUNT_EVENT, onCount);
  }, []);

  const hasItems = count > 0;
  const display = count > 99 ? "99+" : String(count);
  const label = hasItems
    ? `Cart, ${count} ${count === 1 ? "item" : "items"}`
    : "Cart";

  return (
    <Tooltip content="Cart">
      <Link
        href={href}
        aria-label={label}
        className={cn(
          "relative inline-flex size-9 items-center justify-center rounded-full",
          "text-muted-foreground transition-colors outline-none",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <ShoppingCart aria-hidden className="size-5" />
        <AnimatePresence>
          {hasItems ? (
            <motion.span
              // Re-key on the value so the bubble pops when the count changes.
              key={display}
              aria-hidden
              initial={reduced ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }}
              transition={reduced ? { duration: 0 } : springs.snappy}
              className={cn(
                "absolute -top-0.5 -right-0.5 inline-flex min-w-4 items-center justify-center",
                "rounded-full bg-primary px-1 text-[0.625rem] font-semibold leading-4",
                "text-primary-foreground tabular-nums",
              )}
            >
              {display}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </Link>
    </Tooltip>
  );
}
