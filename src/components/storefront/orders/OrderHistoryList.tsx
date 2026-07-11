import Link from "next/link";
import { ChevronRightIcon, PackageIcon } from "lucide-react";

import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";
import { StatusChip } from "@/components/common/StatusChip";
import {
  ORDER_STATUS_LABEL,
  orderStatusVariant,
} from "./order-status";
import type { OrderHistoryRow } from "./types";

/**
 * Customer order-history list — one tappable card per order. Server component
 * (no interactivity): status chip, date, item count and (gated) total, linking
 * to the order detail by its non-enumerable orderNumber.
 */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function OrderHistoryList({ orders }: { orders: OrderHistoryRow[] }) {
  return (
    <ul className="space-y-3">
      {orders.map((order) => (
        <li key={order.orderNumber}>
          <Link
            href={`/account/orders/${encodeURIComponent(order.orderNumber)}`}
            className={cn(
              "group flex items-center gap-4 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-sm ring-1 ring-foreground/5 transition-colors",
              "hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
            )}
          >
            <span
              aria-hidden
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"
            >
              <PackageIcon className="size-5" />
            </span>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium tabular-nums text-foreground">
                  #{order.orderNumber}
                </span>
                <StatusChip
                  variant={orderStatusVariant(order.status)}
                  label={ORDER_STATUS_LABEL[order.status]}
                />
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDate(order.placedAt)} ·{" "}
                {order.itemCount} {order.itemCount === 1 ? "item" : "items"}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {order.subtotalPaise !== null ? (
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  {formatPaise(order.subtotalPaise)}
                </span>
              ) : null}
              <ChevronRightIcon
                aria-hidden
                className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
