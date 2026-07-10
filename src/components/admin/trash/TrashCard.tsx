"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, ImageOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/common";
import { ScaleTap } from "@/components/motion/primitives";
import { restoreProductAction } from "@/server/actions/products";
import type { TrashedProduct } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Computes whole days remaining until purge relative to `now` (epoch ms). */
function daysRemaining(purgeIso: string, now: number): number {
  const diff = new Date(purgeIso).getTime() - now;
  return Math.max(0, Math.ceil(diff / DAY_MS));
}

interface TrashCardProps {
  product: TrashedProduct;
  /** Reference "now" (epoch ms) for the countdown; passed from the server. */
  now: number;
  className?: string;
}

/**
 * A single soft-deleted product card with a restore action and a 30-day
 * retention countdown. On restore it calls the (admin-gated, audited) server
 * action, toasts the outcome, and refreshes the route so the row disappears.
 */
export function TrashCard({ product, now, className }: TrashCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const remaining = daysRemaining(product.purgeAt, now);
  const urgent = remaining <= 3;

  function handleRestore() {
    startTransition(async () => {
      const result = await restoreProductAction(product.id);
      if (result.ok) {
        toast.success(`Restored “${result.product.name}”`);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div
      data-slot="trash-card"
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted text-muted-foreground">
          {product.imageUrl ? (
            // Remote R2 / local upload URL — plain img avoids next/image config.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt=""
              className="size-full object-cover opacity-90"
              loading="lazy"
            />
          ) : (
            <ImageOff aria-hidden className="size-5" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {product.name}
          </p>
          <p className="truncate font-tabular text-xs text-muted-foreground">
            {product.sku}
            {product.brand ? ` · ${product.brand}` : ""}
          </p>
          {product.categoryName ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {product.categoryName}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <StatusChip
          variant={urgent ? "rejected" : "pending"}
          label={
            remaining === 0
              ? "Purges today"
              : `${remaining} day${remaining === 1 ? "" : "s"} left`
          }
        />
        <ScaleTap>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRestore}
            disabled={isPending}
            aria-label={`Restore ${product.name}`}
          >
            {isPending ? (
              <Loader2 aria-hidden className="animate-spin" />
            ) : (
              <ArchiveRestore aria-hidden />
            )}
            Restore
          </Button>
        </ScaleTap>
      </div>
    </div>
  );
}
