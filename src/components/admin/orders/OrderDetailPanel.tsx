"use client";

/**
 * OrderDetailPanel — the admin read/manage view of one order.
 *
 * Left: the frozen snapshot (line items + totals) and the customer note.
 * Right: customer contact, the CUSTOM status control (never a native select),
 * the internal admin note editor, and a CSV export.
 *
 * All money here is the admin-authorised snapshot price (admins always see
 * prices). Nothing is recomputed from the live catalog.
 */

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { ImageOff, PhoneIcon, UserIcon, MapPinIcon } from "lucide-react";

import { formatPaise } from "@/lib/money";
import { StatusChip } from "@/components/common/StatusChip";
import {
  ORDER_STATUS_LABEL,
  orderStatusVariant,
} from "@/components/storefront/orders/order-status";
import { OrderStatusControl } from "./OrderStatusControl";
import { AdminNoteEditor } from "./AdminNoteEditor";
import { OrderCsvButton } from "./OrderCsvButton";
import type { OrderDetailDTO, OrderLineDTO } from "@/server/actions/admin-orders";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OrderDetailPanel({ order }: { order: OrderDetailDTO }) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-xl font-semibold tabular-nums">
              #{order.orderNumber}
            </h1>
            <StatusChip
              variant={orderStatusVariant(order.status)}
              label={ORDER_STATUS_LABEL[order.status]}
            />
          </div>
          <p className="text-sm text-muted-foreground">
            Placed {formatDateTime(order.placedAt)} · {order.itemCount}{" "}
            {order.itemCount === 1 ? "item" : "items"}
          </p>
        </div>
        <OrderCsvButton order={order} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Snapshot */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Items</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {order.items.map((line, i) => (
              <OrderLineRow
                key={`${line.productId}-${line.variantId ?? ""}-${i}`}
                line={line}
              />
            ))}
          </ul>

          <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
            <span className="text-sm font-medium text-muted-foreground">
              Subtotal
            </span>
            <span className="text-base font-semibold tabular-nums text-foreground">
              {formatPaise(order.subtotalPaise)}
            </span>
          </div>

          {order.note ? (
            <div className="rounded-2xl border border-border bg-muted/40 p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Customer note
              </p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">
                {order.note}
              </p>
            </div>
          ) : null}
        </section>

        {/* Manage */}
        <aside className="space-y-5">
          {/* Customer */}
          <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Customer</h2>
            {order.customer ? (
              <div className="space-y-1.5 text-sm">
                <p className="flex items-center gap-2 font-medium">
                  {order.customer.businessName}
                </p>
                <p className="flex items-center gap-2 text-muted-foreground">
                  <UserIcon className="size-3.5" aria-hidden />
                  {order.customer.contactName}
                </p>
                <p className="flex items-center gap-2 text-muted-foreground tabular-nums">
                  <PhoneIcon className="size-3.5" aria-hidden />
                  {order.customer.phone}
                </p>
                {order.customer.city ? (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <MapPinIcon className="size-3.5" aria-hidden />
                    {order.customer.city}
                  </p>
                ) : null}
                <Link
                  href={`/admin/customers?q=${encodeURIComponent(order.customer.phone)}`}
                  className="inline-block pt-1 text-xs font-medium text-primary hover:underline"
                >
                  View customer →
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Customer record unavailable.
              </p>
            )}
          </div>

          {/* Status control */}
          <div className="space-y-2 rounded-2xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Status</h2>
            <OrderStatusControl orderId={order.id} status={order.status} />
            <p className="text-xs text-muted-foreground">
              The customer is notified when you change this.
            </p>
          </div>

          {/* Admin note */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <AdminNoteEditor orderId={order.id} note={order.adminNote} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function OrderLineRow({ line }: { line: OrderLineDTO }) {
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
          Qty {line.quantity} · {formatPaise(line.unitPricePaise)} each
        </p>
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
        {formatPaise(line.lineTotalPaise)}
      </span>
    </li>
  );
}
