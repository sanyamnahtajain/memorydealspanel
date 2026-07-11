"use client";

/**
 * OrderDetailView — the customer's read of a single placed order.
 *
 * Shows the FROZEN snapshot (line items with the price entitled at placement),
 * a status timeline, and two actions:
 *   - Reorder — re-adds still-available items to the live cart via the gated
 *     server action (unavailable lines are skipped, never silently ordered).
 *   - Cancel — only rendered while the order is still PLACED; confirms in a
 *     ConfirmSheet, then flips to CANCELLED and refreshes.
 *
 * PRICE GATE: money is rendered ONLY when `detail.priced` (the server's
 * canSeePrices verdict). A lapsed customer sees the order structure with prices
 * locked — no amount is present in the payload for them.
 */

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ImageOff, RotateCcw, XCircle, LockIcon } from "lucide-react";
import { toast } from "sonner";

import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/common/StatusChip";
import { ConfirmSheet } from "@/components/common/ConfirmSheet";
import { Spinner } from "@/components/ui/spinner";
import {
  ORDER_STATUS_LABEL,
  isCancellable,
  orderStatusVariant,
} from "./order-status";
import { OrderStatusTimeline } from "./OrderStatusTimeline";
import type { OrderHistoryDetail, OrderHistoryLine } from "./types";
import {
  cancelOrderAction,
  reorderAction,
} from "@/app/(storefront)/account/orders/actions";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OrderDetailView({ detail }: { detail: OrderHistoryDetail }) {
  const router = useRouter();
  const [reordering, setReordering] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);

  const cancellable = isCancellable(detail.status);

  const handleReorder = React.useCallback(async () => {
    setReordering(true);
    try {
      const res = await reorderAction(detail.orderNumber);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const skippedNote =
        res.skipped > 0
          ? ` ${res.skipped} item${res.skipped === 1 ? "" : "s"} skipped (unavailable).`
          : "";
      toast.success(
        `Added ${res.added} item${res.added === 1 ? "" : "s"} to your cart.${skippedNote}`,
        {
          action: {
            label: "View cart",
            onClick: () => router.push("/account/cart"),
          },
        },
      );
      router.refresh();
    } catch {
      toast.error("Couldn't reorder. Please try again.");
    } finally {
      setReordering(false);
    }
  }, [detail.orderNumber, router]);

  const handleCancel = React.useCallback(async () => {
    setCancelling(true);
    try {
      const res = await cancelOrderAction(detail.orderNumber);
      if (!res.ok) {
        toast.error(res.error);
        // Re-throw so the ConfirmSheet stays open for a retry.
        throw new Error(res.error);
      }
      toast.success("Order cancelled.");
      router.refresh();
    } finally {
      setCancelling(false);
    }
  }, [detail.orderNumber, router]);

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm ring-1 ring-foreground/5">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-lg font-semibold tabular-nums">
              #{detail.orderNumber}
            </h2>
            <StatusChip
              variant={orderStatusVariant(detail.status)}
              label={ORDER_STATUS_LABEL[detail.status]}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Placed {formatDateTime(detail.placedAt)} · {detail.itemCount}{" "}
            {detail.itemCount === 1 ? "item" : "items"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleReorder}
            disabled={reordering}
            data-loading={reordering || undefined}
          >
            {reordering ? (
              <Spinner size="sm" label="" />
            ) : (
              <RotateCcw aria-hidden />
            )}
            Reorder
          </Button>
          {cancellable ? (
            <ConfirmSheet
              title="Cancel this order?"
              description="This withdraws your purchase request. You can place it again anytime while it's still open."
              destructive
              confirmLabel="Cancel order"
              cancelLabel="Keep order"
              onConfirm={handleCancel}
              trigger={
                <Button variant="destructive" disabled={cancelling}>
                  <XCircle aria-hidden />
                  Cancel
                </Button>
              }
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        {/* Line items (frozen snapshot) */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Items</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {detail.items.map((line, i) => (
              <OrderLineRow key={`${line.productId}-${line.variantId ?? ""}-${i}`} line={line} priced={detail.priced} />
            ))}
          </ul>

          {/* Totals */}
          <div className="rounded-2xl border border-border bg-card p-4">
            {detail.priced && detail.subtotalPaise !== null ? (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Subtotal
                </span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {formatPaise(detail.subtotalPaise)}
                </span>
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LockIcon className="size-3.5" aria-hidden />
                Prices are hidden until your access is renewed.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              This is a purchase request — no payment was collected. The
              wholesaler will confirm and arrange fulfilment offline.
            </p>
          </div>

          {detail.note ? (
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Your note
              </p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">
                {detail.note}
              </p>
            </div>
          ) : null}
        </section>

        {/* Timeline */}
        <aside className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Progress</h3>
          <div className="rounded-2xl border border-border bg-card p-4">
            <OrderStatusTimeline status={detail.status} />
          </div>
          <p className="text-xs text-muted-foreground">
            Last updated {formatDateTime(detail.updatedAt)}
          </p>
        </aside>
      </div>
    </div>
  );
}

function OrderLineRow({
  line,
  priced,
}: {
  line: OrderHistoryLine;
  priced: boolean;
}) {
  return (
    <li className="flex items-center gap-3 p-3">
      <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">
        {line.imageUrl ? (
          <Image
            src={line.imageUrl}
            alt=""
            width={56}
            height={56}
            className="size-full object-cover"
          />
        ) : (
          <ImageOff className="size-5 text-muted-foreground" aria-hidden />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {line.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {line.variantLabel ? `${line.variantLabel} · ` : ""}
          {line.sku}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
          Qty {line.quantity}
          {priced && line.unitPricePaise !== null
            ? ` · ${formatPaise(line.unitPricePaise)} each`
            : ""}
        </p>
      </div>

      {priced && line.lineTotalPaise !== null ? (
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
          {formatPaise(line.lineTotalPaise)}
        </span>
      ) : (
        <LockIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
    </li>
  );
}
