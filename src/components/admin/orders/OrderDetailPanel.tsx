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
import { useRouter } from "next/navigation";
import {
  ImageOff,
  PhoneIcon,
  UserIcon,
  MapPinIcon,
  TruckIcon,
  ExternalLinkIcon,
  PencilIcon,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";

import { APP_NAME } from "@/lib/constants";
import { formatPaise } from "@/lib/money";
import type { OrderTracking } from "@/lib/tracking";
import {
  buildWhatsAppLink,
  normaliseWhatsAppNumber,
  orderStatusMessageLines,
} from "@/lib/whatsapp-link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { StatusChip } from "@/components/common/StatusChip";
import {
  ORDER_STATUS_LABEL,
  orderStatusVariant,
} from "@/components/storefront/orders/order-status";
import { OrderStatusControl } from "./OrderStatusControl";
import { AdminNoteEditor } from "./AdminNoteEditor";
import { OrderCsvButton } from "./OrderCsvButton";
import { OrderTaxBreakup } from "@/components/storefront/orders/OrderTaxBreakup";
import { OrderBucketSections } from "@/components/orders/billing/OrderBucketSections";
import { AccessExtensionNotice } from "./AccessExtensionNotice";
import { DeliveryNotice } from "@/components/storefront/orders/DeliveryNotice";
import { DeliveryChargeRow } from "@/components/orders/DeliveryChargeRow";
import { BillingTotalsRows } from "@/components/orders/billing/BillingTotalsRows";
import {
  setOrderTrackingAction,
  type OrderDetailDTO,
  type OrderLineDTO,
} from "@/server/actions/admin-orders";

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
  const groupDiscountPaise = order.billing?.groupDiscountPaise ?? 0;
  const totalDiscountPaise = groupDiscountPaise + order.discountPaise;
  // Frozen delivery CHARGE: added after the discounts and after GST, never
  // taxed here. 0 on an order placed before it was charged — every branch then
  // collapses to the exact pre-delivery rendering. With GST on, the delivery
  // line and the payable total live in the tax breakup below.
  const deliveryChargePaise = order.deliveryChargePaise;
  const showDeliveryHere = deliveryChargePaise > 0 && !order.tax;
  const showTotalRow = showDeliveryHere || (totalDiscountPaise > 0 && !order.tax);
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
            {/* The completed moment — stamped once on the transition into
                FULFILLED, so later edits (tracking, notes) never move it.
                Legacy orders fulfilled before the stamp existed show nothing
                rather than a guessed date. */}
            {order.fulfilledAt ? (
              <>
                {" · "}
                <span className="font-medium text-foreground">
                  Completed {formatDateTime(order.fulfilledAt)}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <WhatsAppCustomerButton order={order} />
          <OrderCsvButton order={order} />
        </div>
      </div>

      {/* Anti-abuse: this order granted access time — visible + retractable. */}
      {order.accessExtension ? (
        <AccessExtensionNotice orderId={order.id} extension={order.accessExtension} />
      ) : null}
      {/* Frozen delivery terms the buyer saw at placement. */}
      <DeliveryNotice
        delivery={order.delivery}
        charged={deliveryChargePaise > 0}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* Snapshot */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Items</h2>
          {order.billing ? (
            // Lines grouped by billing bucket (frozen at placement).
            <OrderBucketSections
              lines={order.items}
              billing={order.billing}
              orderNumber={order.orderNumber}
              renderLine={(line) => <OrderLineRow line={line} />}
            />
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {order.items.map((line, i) => (
                <OrderLineRow
                  key={`${line.productId}-${line.variantId ?? ""}-${i}`}
                  line={line}
                />
              ))}
            </ul>
          )}

          <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">
                {order.tax ? "Taxable subtotal" : "Subtotal"}
              </span>
              <span className="text-base font-semibold tabular-nums text-foreground">
                {formatPaise(order.subtotalPaise)}
              </span>
            </div>
            <BillingTotalsRows billing={order.billing} />
            {order.discountPaise > 0 ? (
              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300">
                <span className="text-sm font-medium">
                  Coupon{order.couponCode ? ` ${order.couponCode}` : ""}
                </span>
                <span className="text-sm font-semibold tabular-nums">
                  −{formatPaise(order.discountPaise)}
                </span>
              </div>
            ) : null}
            {showDeliveryHere ? (
              <DeliveryChargeRow
                chargePaise={deliveryChargePaise}
                className="border-t border-border pt-1.5"
              />
            ) : null}
            {/* With GST the frozen grand total (tax breakup below) already nets the
                discounts, and carries the delivery line + payable total. */}
            {showTotalRow ? (
              <div className="flex items-center justify-between border-t border-border pt-1.5">
                <span className="text-sm font-medium text-muted-foreground">Total</span>
                <span className="text-base font-semibold tabular-nums text-foreground">
                  {formatPaise(
                    order.subtotalPaise - totalDiscountPaise + deliveryChargePaise,
                  )}
                </span>
              </div>
            ) : null}
          </div>

          {/* Frozen GST breakup (admins always see amounts). */}
          {order.tax ? (
            <OrderTaxBreakup
              tax={order.tax}
              deliveryChargePaise={deliveryChargePaise}
            />
          ) : null}

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

          {/* Courier tracking */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <DeliveryTrackingCard orderId={order.id} tracking={order.tracking} />
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

/** WhatsApp-green accent over the outline button, in both admin themes. */
const WHATSAPP_BUTTON_CLASSES =
  "border-emerald-600/40 text-emerald-700 hover:bg-emerald-600/10 hover:text-emerald-700 dark:border-emerald-300/40 dark:text-emerald-300 dark:hover:bg-emerald-300/10 dark:hover:text-emerald-300";

/**
 * WhatsAppCustomerButton — one tap from this order to a pre-filled WhatsApp
 * message to ITS customer ("Namaste …, your order MD-XXX is confirmed…").
 *
 * The message is minted at render time from the CURRENT status + tracking, so
 * once staff save tracking and the panel refreshes, the same button's message
 * carries the courier details automatically. Pure deep link — no server
 * action, nothing stored. The customer's phone is already in this admin-only
 * DTO (it's their login); if it's somehow missing we render a disabled button
 * with a tooltip, never a dead link.
 */
function WhatsAppCustomerButton({ order }: { order: OrderDetailDTO }) {
  const phone = order.customer?.phone ?? "";
  const hasPhone = normaliseWhatsAppNumber(phone) !== "";

  if (!order.customer || !hasPhone) {
    return (
      <Tooltip content="This customer has no phone number to message.">
        {/* Wrapper span: a disabled button swallows pointer events, so the
            tooltip needs a live (and focusable) trigger around it. */}
        <span className="inline-flex" tabIndex={0}>
          <Button
            variant="outline"
            size="sm"
            disabled
            className={WHATSAPP_BUTTON_CLASSES}
          >
            <MessageCircle aria-hidden />
            WhatsApp customer
          </Button>
        </span>
      </Tooltip>
    );
  }

  const href = buildWhatsAppLink(
    phone,
    orderStatusMessageLines({
      appName: APP_NAME,
      contactName: order.customer.contactName || order.customer.businessName,
      orderNumber: order.orderNumber,
      status: order.status,
      tracking: order.tracking,
    }),
  );

  return (
    <Button
      variant="outline"
      size="sm"
      className={WHATSAPP_BUTTON_CLASSES}
      render={
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`WhatsApp ${order.customer.businessName} about order ${order.orderNumber}`}
        />
      }
    >
      <MessageCircle aria-hidden />
      WhatsApp customer
    </Button>
  );
}

/**
 * DeliveryTrackingCard — attach/edit the courier tracking on this order.
 *
 * Shows the saved values with an Edit affordance once set; otherwise the form.
 * One Save via the guarded server action; the FIRST save also notifies the
 * buyer that their parcel is on the way (handled server-side).
 */
function DeliveryTrackingCard({
  orderId,
  tracking,
}: {
  orderId: string;
  tracking: OrderTracking | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [courierName, setCourierName] = React.useState(tracking?.courierName ?? "");
  const [trackingId, setTrackingId] = React.useState(tracking?.trackingId ?? "");
  const [url, setUrl] = React.useState(tracking?.url ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const showForm = editing || !tracking;
  const canSave = trackingId.trim() !== "" || url.trim() !== "";

  const save = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await setOrderTrackingAction({
        id: orderId,
        tracking: { courierName, trackingId, url },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success("Tracking saved. The customer can see it on their order.");
      setEditing(false);
      router.refresh();
    } catch {
      setError("Couldn't save the tracking. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [courierName, orderId, router, trackingId, url]);

  const startEdit = React.useCallback(() => {
    setCourierName(tracking?.courierName ?? "");
    setTrackingId(tracking?.trackingId ?? "");
    setUrl(tracking?.url ?? "");
    setError(null);
    setEditing(true);
  }, [tracking]);

  return (
    <div className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <TruckIcon className="size-4 text-muted-foreground" aria-hidden />
        Delivery tracking
      </h2>
      {showForm ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            The customer sees this on their order page. Add a tracking number
            or a link (or both).
          </p>
          <div className="space-y-1">
            <label
              htmlFor={`tracking-courier-${orderId}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Courier name
            </label>
            <Input
              id={`tracking-courier-${orderId}`}
              value={courierName}
              maxLength={60}
              onChange={(e) => setCourierName(e.target.value)}
              placeholder="e.g. Bluedart"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`tracking-id-${orderId}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Tracking number
            </label>
            <Input
              id={`tracking-id-${orderId}`}
              value={trackingId}
              maxLength={64}
              onChange={(e) => setTrackingId(e.target.value)}
              placeholder="e.g. AWB12345678"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor={`tracking-url-${orderId}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Tracking link
            </label>
            <Input
              id={`tracking-url-${orderId}`}
              type="url"
              inputMode="url"
              value={url}
              maxLength={2048}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              aria-invalid={error !== null || undefined}
            />
          </div>
          {error ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex items-center justify-end gap-2 pt-1">
            {tracking ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            ) : null}
            <Button size="sm" onClick={save} disabled={!canSave || busy}>
              {busy ? <Spinner size="sm" label="" /> : null}
              Save tracking
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 text-sm">
          {tracking?.courierName ? (
            <p className="font-medium text-foreground">{tracking.courierName}</p>
          ) : null}
          {tracking?.trackingId ? (
            <p className="text-muted-foreground select-all tabular-nums">
              {tracking.trackingId}
            </p>
          ) : null}
          {tracking?.url ? (
            <a
              href={tracking.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              Open tracking page
              <ExternalLinkIcon className="size-3" aria-hidden />
            </a>
          ) : null}
          <div className="pt-1">
            <Button size="sm" variant="outline" onClick={startEdit}>
              <PencilIcon aria-hidden />
              Edit
            </Button>
          </div>
        </div>
      )}
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
        {line.breakdown && line.breakdown.length > 0 ? (
          <p className="mt-0.5 min-w-0 text-[0.65rem] leading-relaxed [overflow-wrap:anywhere] text-muted-foreground">
            {line.breakdown.map((b) => `${b.qty} × ${b.modelName}`).join(" · ")}
          </p>
        ) : null}
        {line.note ? (
          <p className="mt-1 rounded-md bg-muted/50 px-2 py-1 text-xs whitespace-pre-line text-muted-foreground">
            {line.note}
          </p>
        ) : null}
        {line.attachments && line.attachments.length > 0 ? (
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {line.attachments.map((a) => (
              <a
                key={a.url}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-md border border-border"
                title="Open requirement photo"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.url}
                  alt="Requirement photo"
                  loading="lazy"
                  className="size-14 object-cover"
                />
              </a>
            ))}
          </span>
        ) : null}
        {line.tax ? (
          <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
            {line.tax.taxInclusive ? "incl." : "+"} {line.tax.gstRateBps / 100}% GST
            {line.tax.hsnCode ? ` · HSN ${line.tax.hsnCode}` : ""}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
        {formatPaise(line.lineTotalPaise)}
      </span>
    </li>
  );
}
