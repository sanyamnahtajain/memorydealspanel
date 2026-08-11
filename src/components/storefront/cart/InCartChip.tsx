"use client";

import { ShoppingCart } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  ensureCartLinesPrimed,
  useProductInCartQty,
} from "./cart-lines-store";
import * as React from "react";

/**
 * InCartChip — "In cart · N" over a product card image. Reads the client
 * cart-lines store (server-primed once, kept live by the add/update flows),
 * so it appears instantly after a quick-add WITHOUT re-rendering the listing.
 * Renders nothing when the product isn't in the cart.
 */
export function InCartChip({
  productId,
  className,
}: {
  productId: string;
  className?: string;
}) {
  const qty = useProductInCartQty(productId);
  // Prime lazily from the first chip on the page (no-op after the first call).
  React.useEffect(() => {
    ensureCartLinesPrimed();
  }, []);
  if (qty <= 0) return null;
  return (
    <span
      className={cn(
        "pointer-events-none absolute bottom-1.5 left-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-primary/95 px-2 py-0.5 text-[0.65rem] font-semibold text-primary-foreground shadow-sm",
        className,
      )}
    >
      <ShoppingCart aria-hidden className="size-3" />
      In cart · {qty}
    </span>
  );
}
