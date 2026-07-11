"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { Tooltip } from "@/components/ui/tooltip";
import { springs } from "@/components/motion/tokens";
import { cn } from "@/lib/utils";
import { toggleWishlistAction } from "@/server/actions/wishlist";
import { broadcastWishlistCount } from "./WishlistBadge";

/**
 * HeartButton — the save-to-wishlist toggle used on product cards, the product
 * page, and quick-view. Optimistic: it flips the fill instantly and rolls back
 * (with a toast) only if the server rejects. An anonymous viewer is routed to
 * `/account/login` rather than shown an error — you must be signed in to save.
 *
 * The heart is a fully custom control (no native checkbox): `aria-pressed`
 * carries the saved state for assistive tech, and the fill/scale pop respects
 * the reduced-motion preference.
 */

const MotionHeart = motion.create(Heart);

export interface HeartButtonProps {
  /** The product this heart saves. */
  productId: string;
  /** Server-hydrated initial saved state (from `wishlistProductIds`). */
  initialSaved?: boolean;
  /** Compact hearts sit on dense cards; default is the roomier product-page size. */
  size?: "default" | "compact";
  /** Notified after a successful toggle so parents can update counts/lists. */
  onToggled?: (saved: boolean) => void;
  className?: string;
}

const SIZE_STYLES: Record<
  NonNullable<HeartButtonProps["size"]>,
  { button: string; icon: string }
> = {
  default: { button: "size-9", icon: "size-5" },
  compact: { button: "size-7", icon: "size-4" },
};

export function HeartButton({
  productId,
  initialSaved = false,
  size = "default",
  onToggled,
  className,
}: HeartButtonProps) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [saved, setSaved] = React.useState(initialSaved);
  const [pending, startTransition] = React.useTransition();

  // Keep in sync if the server re-hydrates a different initial state (e.g. the
  // same card re-used for another product in a virtualised list). Adjusting
  // state during render (the React-recommended pattern) avoids a cascading
  // effect: when the seeded prop changes we snap to it immediately.
  const [seenInitial, setSeenInitial] = React.useState(initialSaved);
  if (seenInitial !== initialSaved) {
    setSeenInitial(initialSaved);
    setSaved(initialSaved);
  }

  const styles = SIZE_STYLES[size];

  function handleToggle() {
    if (pending) return;
    const next = !saved;
    // Optimistic flip.
    setSaved(next);

    startTransition(async () => {
      const result = await toggleWishlistAction(productId);
      if (result.ok) {
        // Trust the server's resulting state (handles idempotent races) and
        // keep the header badge in lock-step with the fresh count.
        setSaved(result.saved);
        broadcastWishlistCount(result.count);
        onToggled?.(result.saved);
        return;
      }
      // Roll back the optimistic flip.
      setSaved(!next);
      if (result.needsLogin) {
        toast.info("Sign in to save products to your wishlist.");
        router.push("/account/login");
        return;
      }
      toast.error(result.error);
    });
  }

  const label = saved ? "Remove from wishlist" : "Save to wishlist";

  return (
    <Tooltip content={label}>
      <motion.button
        type="button"
        aria-pressed={saved}
        aria-label={label}
        aria-busy={pending || undefined}
        onClick={handleToggle}
        whileTap={reduced ? undefined : { scale: 0.86 }}
        transition={springs.snappy}
        className={cn(
          "inline-flex items-center justify-center rounded-full text-muted-foreground",
          "transition-colors outline-none",
          "hover:bg-muted hover:text-foreground",
          "focus-visible:ring-3 focus-visible:ring-ring/50",
          saved && "text-destructive hover:text-destructive",
          styles.button,
          className,
        )}
      >
        <MotionHeart
          aria-hidden
          className={cn(styles.icon)}
          // Fill the heart when saved; the stroke stays for the outline.
          fill={saved ? "currentColor" : "none"}
          animate={
            reduced
              ? undefined
              : saved
                ? { scale: [1, 1.28, 1] }
                : { scale: 1 }
          }
          transition={reduced ? { duration: 0 } : springs.snappy}
        />
      </motion.button>
    </Tooltip>
  );
}
