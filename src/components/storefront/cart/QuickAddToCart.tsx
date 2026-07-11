"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Plus } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";

import { Tooltip } from "@/components/ui/tooltip";
import { springs } from "@/components/motion/tokens";
import { cn } from "@/lib/utils";
import { MIN_QTY_PER_LINE } from "@/lib/schemas/cart";
import { addToCartAction } from "@/server/actions/cart";
import { broadcastCartCount } from "./CartBadge";

/**
 * QuickAddToCart — a compact, single-tap add-to-cart control for product cards.
 *
 * Unlike {@link import("./AddToCartButton").AddToCartButton} (the full stepper
 * on the detail page), this is one small icon button that adds the product's
 * MOQ (or 1) to the cart in a single tap, showing an ephemeral tick on success.
 * It is meant to live INSIDE a card `<Link>`, so it swallows the click to avoid
 * navigating away.
 *
 * GATE: rendered ONLY when the viewer is an approved customer who can add
 * (`canAdd`) and the product is in stock — the caller (the listing, which knows
 * `canSeePrices`) decides. It sends only { productId, variantId?, quantity };
 * never a price. Access + price are re-checked server-side on every add.
 */
export interface QuickAddToCartProps {
  productId: string;
  variantId?: string | null;
  /** MOQ floor — the quantity a single quick-add contributes. Defaults to 1. */
  moq?: number | null;
  className?: string;
}

export function QuickAddToCart({
  productId,
  variantId = null,
  moq,
  className,
}: QuickAddToCartProps) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [pending, startTransition] = React.useTransition();
  const [justAdded, setJustAdded] = React.useState(false);
  const resetRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    },
    [],
  );

  const quantity = React.useMemo(() => {
    const m = typeof moq === "number" && moq >= MIN_QTY_PER_LINE ? Math.trunc(moq) : MIN_QTY_PER_LINE;
    return m;
  }, [moq]);

  function handleAdd(e: React.MouseEvent) {
    // Live inside a card link — never follow it on a quick-add tap.
    e.preventDefault();
    e.stopPropagation();
    if (pending) return;

    startTransition(async () => {
      const result = await addToCartAction({
        productId,
        ...(variantId ? { variantId } : {}),
        quantity,
      });

      if (result.ok) {
        broadcastCartCount(result.itemCount);
        setJustAdded(true);
        if (resetRef.current) clearTimeout(resetRef.current);
        resetRef.current = setTimeout(() => setJustAdded(false), 1600);
        toast.success(
          result.clamped
            ? `Added — quantity set to ${result.quantity} (minimum order).`
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
    <Tooltip content={justAdded ? "Added to cart" : "Add to cart"}>
      <motion.button
        type="button"
        aria-label="Add to cart"
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={handleAdd}
        whileTap={reduced || pending ? undefined : { scale: 0.9 }}
        transition={springs.snappy}
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-full",
          "bg-primary text-primary-foreground shadow-sm outline-none",
          "transition-[background-color,transform] hover:bg-primary/90",
          "focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:opacity-70",
          className,
        )}
      >
        {pending ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : justAdded ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Plus aria-hidden className="size-4" />
        )}
      </motion.button>
    </Tooltip>
  );
}
