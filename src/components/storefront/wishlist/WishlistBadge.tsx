"use client";

import * as React from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Tooltip } from "@/components/ui/tooltip";
import { springs } from "@/components/motion/tokens";
import { cn } from "@/lib/utils";

/**
 * WishlistBadge — the header / bottom-tab entry point to the saved-products
 * page, with a live count bubble. It renders a heart that links to
 * `/account/wishlist`; the bubble appears only when the customer has saved at
 * least one product.
 *
 * The count is seeded from the server (`initialCount`, from `wishlistCount`)
 * and can be kept fresh optimistically without a round trip: any component
 * (e.g. HeartButton) may broadcast the new count via
 * `dispatchEvent(new CustomEvent("wishlist:count", { detail: n }))`. That keeps
 * the header in lock-step with an optimistic heart toggle. Guests never see
 * this control — the shell only mounts it for a logged-in customer.
 */

/** The DOM event name the badge listens on for optimistic count updates. */
export const WISHLIST_COUNT_EVENT = "wishlist:count";

/**
 * Broadcast a new saved-count so any mounted {@link WishlistBadge} updates
 * immediately. Call after a successful wishlist toggle.
 */
export function broadcastWishlistCount(count: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WISHLIST_COUNT_EVENT, { detail: count }),
  );
}

export interface WishlistBadgeProps {
  /** Server-hydrated saved count. */
  initialCount?: number;
  /** Href of the wishlist page. */
  href?: string;
  className?: string;
}

export function WishlistBadge({
  initialCount = 0,
  href = "/account/wishlist",
  className,
}: WishlistBadgeProps) {
  const reduced = useReducedMotion();
  const [count, setCount] = React.useState(initialCount);

  // Re-seed from the server prop by adjusting state during render (the
  // React-recommended pattern) rather than in an effect, avoiding a cascading
  // render when the header re-renders with a fresh count.
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
    window.addEventListener(WISHLIST_COUNT_EVENT, onCount);
    return () => window.removeEventListener(WISHLIST_COUNT_EVENT, onCount);
  }, []);

  const hasItems = count > 0;
  const display = count > 99 ? "99+" : String(count);
  const label = hasItems
    ? `Wishlist, ${count} saved ${count === 1 ? "product" : "products"}`
    : "Wishlist";

  return (
    <Tooltip content="Wishlist">
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
        <Heart
          aria-hidden
          className="size-5"
          fill={hasItems ? "currentColor" : "none"}
        />
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
                "rounded-full bg-destructive px-1 text-[0.625rem] font-semibold leading-4",
                "text-destructive-foreground tabular-nums",
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
