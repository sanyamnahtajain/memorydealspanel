import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ImageOff } from "lucide-react";

import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import { getOrderForCustomer } from "@/server/services/orders";
import { cartCountForViewer } from "@/server/services/cart";
import { APP_NAME } from "@/lib/constants";
import { formatPaise } from "@/lib/money";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { FadeUp } from "@/components/motion/primitives";
import { OrderTaxBreakup } from "@/components/storefront/orders/OrderTaxBreakup";
import { DeliveryNotice } from "@/components/storefront/orders/DeliveryNotice";
import { DeliveryChargeRow } from "@/components/orders/DeliveryChargeRow";
import { OrderBucketSections } from "@/components/orders/billing/OrderBucketSections";
import { BillingTotalsRows } from "@/components/orders/billing/BillingTotalsRows";
import { toOrderBillingView } from "@/components/orders/billing/types";
import { OrderCelebration } from "@/components/slaby/OrderCelebration";
import { getSlabyBranding } from "@/server/services/store-settings";
import { slabyPlacementOn } from "@/lib/slaby/branding";
import type { OrderItemSnapshot } from "@/server/services/orders";

/**
 * Order confirmation page.
 *
 * SECURITY:
 *  - The order is fetched via `getOrderForCustomer(viewer.customerId, number)`
 *    which is BOTH random-number and ownership scoped — a guessed/foreign order
 *    number returns null (indistinguishable from "not found"), so nothing leaks.
 *  - Prices shown here are the SERVER snapshot stored on the order at placement;
 *    they are only rendered when the viewer is price-authorised.
 */
export const metadata: Metadata = {
  title: `Order placed — ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface ConfirmationPageProps {
  searchParams: Promise<{ order?: string }>;
}

export default async function OrderConfirmationPage({
  searchParams,
}: ConfirmationPageProps) {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    redirect(viewer.kind === "admin" ? "/admin" : "/account/login");
  }

  const { order: orderNumber } = await searchParams;
  const order = orderNumber
    ? await getOrderForCustomer(viewer.customerId, orderNumber)
    : null;
  const priced = canSeePrices(viewer);
  // Cart was just cleared at placement; reflect the fresh count in the header.
  const cartCount = await cartCountForViewer(viewer);

  if (!order) {
    return (
      <StorefrontShell cartCount={cartCount}>
        <div className="mx-auto w-full max-w-2xl py-10">
          <EmptyState
            illustration="empty-box"
            title="Order not found"
            description="We couldn't find that order. It may have been placed under a different account."
            action={
              <Button render={<Link href="/account" />}>Back to account</Button>
            }
          />
        </div>
      </StorefrontShell>
    );
  }

  const placed = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(order.placedAt);

  // Bucket amounts are prices — only a priced viewer gets the grouped view.
  const billing = priced ? toOrderBillingView(order.billing, order.orderNumber) : null;
  const totalDiscountPaise = (billing?.groupDiscountPaise ?? 0) + order.discountPaise;
  // Frozen delivery CHARGE — added after every discount and after GST. 0 on an
  // order placed before it was charged, which renders exactly as it always did.
  // With GST on, the delivery line + payable total live in the tax breakup.
  const deliveryChargePaise = order.deliveryChargePaise;
  const showDeliveryHere = priced && deliveryChargePaise > 0 && !order.tax;
  const showTotalRow = showDeliveryHere || (totalDiscountPaise > 0 && !order.tax);

  const renderItem = (item: OrderItemSnapshot) => (
    <li className="flex gap-3 p-3">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
        {item.imageUrl ? (
          <Image
            src={item.imageUrl}
            alt=""
            fill
            sizes="56px"
            className="object-cover"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-4" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {item.brand ? (
          <p className="truncate text-xs text-muted-foreground">
            {item.brand}
          </p>
        ) : null}
        <p className="line-clamp-2 text-sm font-medium text-foreground">
          {item.name}
        </p>
        {item.variantLabel ? (
          <p className="truncate text-xs text-muted-foreground">
            {item.variantLabel}
          </p>
        ) : null}
        <p className="text-[0.7rem] text-muted-foreground">
          Qty {item.quantity}
        </p>
      </div>
      {priced ? (
        <div className="text-right">
          <p className="text-sm font-semibold text-foreground tabular-nums">
            {formatPaise(item.lineTotalPaise)}
          </p>
          <p className="text-[0.7rem] text-muted-foreground tabular-nums">
            {formatPaise(item.unitPricePaise)} each
          </p>
        </div>
      ) : null}
    </li>
  );

  return (
    <StorefrontShell cartCount={cartCount}>
      <div className="mx-auto w-full max-w-2xl py-8 sm:py-10">
        {/* Animated "order placed" celebration (plays once per order); credits
            Slaby only when the admin toggle is on. */}
        <OrderCelebration
          orderNumber={order.orderNumber}
          placedLabel={placed}
          showSlaby={slabyPlacementOn(await getSlabyBranding(), "orderSuccess")}
        />

        <FadeUp delay={0.05}>
          <div className="mt-8 space-y-3">
            {billing ? (
              // Lines grouped by billing bucket (frozen at placement).
              <OrderBucketSections
                lines={order.items}
                billing={billing}
                orderNumber={order.orderNumber}
                renderLine={renderItem}
              />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <ul className="divide-y divide-border">
                  {order.items.map((item) => (
                    <React.Fragment key={`${item.productId}:${item.variantId ?? ""}`}>
                      {renderItem(item)}
                    </React.Fragment>
                  ))}
                </ul>
              </div>
            )}

            {/* Totals */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  Subtotal ({order.itemCount} item{order.itemCount === 1 ? "" : "s"})
                </span>
                <span className="text-base font-semibold text-foreground tabular-nums">
                  {priced ? formatPaise(order.subtotalPaise) : "On confirmation"}
                </span>
              </div>
              {priced ? (
                <>
                  <BillingTotalsRows billing={billing} />
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
                  {/* With GST the frozen grand total (breakup below) already nets the
                      discounts, and carries the delivery line + payable total. */}
                  {showTotalRow ? (
                    <div className="flex items-center justify-between border-t border-border pt-1.5">
                      <span className="text-sm font-medium text-muted-foreground">Total</span>
                      <span className="text-base font-semibold text-foreground tabular-nums">
                        {formatPaise(
                          order.subtotalPaise - totalDiscountPaise + deliveryChargePaise,
                        )}
                      </span>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        </FadeUp>

        {/* Frozen GST breakup (proforma) — only for a priced viewer. */}
        {priced && order.tax ? (
          <FadeUp delay={0.07}>
            <div className="mt-4">
              <OrderTaxBreakup
                tax={order.tax}
                proforma
                deliveryChargePaise={deliveryChargePaise}
              />
            </div>
          </FadeUp>
        ) : null}

        {/* The delivery terms the buyer accepted (frozen at placement). Shown
            whether or not GST applied — it is a charge on every order. */}
        {order.delivery ? (
          <FadeUp delay={0.08}>
            <DeliveryNotice
              delivery={order.delivery}
              charged={deliveryChargePaise > 0}
              className="mt-4"
            />
          </FadeUp>
        ) : null}

        {order.note ? (
          <FadeUp delay={0.08}>
            <div className="mt-4 rounded-xl border border-border bg-card p-3">
              <p className="text-xs font-medium text-muted-foreground">
                Your note
              </p>
              <p className="mt-1 text-sm whitespace-pre-wrap text-foreground">
                {order.note}
              </p>
            </div>
          </FadeUp>
        ) : null}

        <FadeUp delay={0.1}>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <Button render={<Link href="/account/orders" />}>
              View my orders
            </Button>
            <Button render={<Link href="/categories" />} variant="outline">
              Continue browsing
            </Button>
          </div>
        </FadeUp>
      </div>
    </StorefrontShell>
  );
}
