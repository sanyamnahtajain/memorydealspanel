"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Lock, ShoppingCart } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clampQuantity } from "@/lib/quantity";
import { addToCartAction } from "@/server/actions/cart";
import { broadcastCartCount } from "@/components/storefront/cart/CartBadge";
import { broadcastLineAdded } from "@/components/storefront/cart/cart-events";
import {
  ModelAllocationBuilder,
  type AllocationRow,
} from "./ModelAllocationBuilder";

/**
 * AllocationAddToCart — the buy control for allocation-required products
 * (replaces the plain qty stepper): the model builder + an Add button that
 * only unlocks when the split's total satisfies the MOQ/pack rule.
 *
 * Sends `{ productId, quantity, breakdown }` — quantity always equals the
 * split's sum; the server re-validates and merges into any existing line.
 */
export function AllocationAddToCart({
  productId,
  moq,
  packMultiple,
  canAdd,
  isCustomer = false,
  outOfStock = false,
  className,
}: {
  productId: string;
  moq?: number | null;
  packMultiple?: number | null;
  canAdd: boolean;
  isCustomer?: boolean;
  outOfStock?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [rows, setRows] = React.useState<AllocationRow[]>([]);
  const [pending, startTransition] = React.useTransition();

  if (!canAdd) {
    const label = isCustomer ? "Approval required to order" : "Sign in to order";
    return (
      <Button
        type="button"
        size="lg"
        variant="outline"
        onClick={() =>
          router.push(isCustomer ? "/account?request=1" : "/account/login")
        }
        className={cn("h-11 w-full gap-2", className)}
      >
        <Lock aria-hidden className="size-4" />
        {label}
      </Button>
    );
  }

  if (outOfStock) {
    return (
      <Button
        type="button"
        size="lg"
        variant="outline"
        disabled
        className={cn("h-11 w-full gap-2", className)}
      >
        <ShoppingCart aria-hidden className="size-4" />
        Out of stock
      </Button>
    );
  }

  const total = rows.reduce((acc, r) => acc + r.qty, 0);
  const ready =
    total > 0 && clampQuantity(total, moq, packMultiple) === total && !pending;

  function handleAdd() {
    if (!ready) return;
    startTransition(async () => {
      const result = await addToCartAction({
        productId,
        quantity: total,
        breakdown: rows.map((r) => ({ modelId: r.modelId, qty: r.qty })),
      });
      if (result.ok) {
        broadcastCartCount(result.itemCount);
        broadcastLineAdded(productId);
        setRows([]);
        toast.success(`Added — ${result.quantity} units across your models.`, {
          action: {
            label: "View cart",
            onClick: () => router.push("/account/cart"),
          },
        });
        return;
      }
      if (result.reason === "breakdown" && result.requiredTotal) {
        // The server merged with an existing line and the combined total now
        // misses the MOQ/pack rule — tell the buyer exactly what to reach.
        toast.error(result.message);
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
    <div className={cn("flex flex-col gap-3", className)}>
      <p className="text-sm font-medium text-foreground">
        Which models do you need?
      </p>
      <ModelAllocationBuilder
        value={rows}
        onChange={setRows}
        productId={productId}
        moq={moq}
        packMultiple={packMultiple}
        disabled={pending}
      />
      <Button
        type="button"
        size="lg"
        aria-busy={pending || undefined}
        disabled={!ready}
        onClick={handleAdd}
        className="h-11 w-full gap-2"
      >
        <ShoppingCart aria-hidden className="size-4" />
        {pending ? "Adding…" : total > 0 ? `Add ${total} to cart` : "Add to cart"}
      </Button>
    </div>
  );
}
