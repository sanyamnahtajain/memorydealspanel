import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { CheckCircle2, ImageOff, Package } from "lucide-react";

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

  return (
    <StorefrontShell cartCount={cartCount}>
      <div className="mx-auto w-full max-w-2xl py-8 sm:py-10">
        <FadeUp>
          <div className="flex flex-col items-center text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
              <CheckCircle2 className="size-8" />
            </span>
            <h1 className="mt-4 text-xl font-semibold text-foreground">
              Order request placed
            </h1>
            <p className="mt-1 max-w-md text-sm text-pretty text-muted-foreground">
              Thanks — your purchase request is in. Our team will confirm
              availability and pricing with you shortly. No payment is taken now.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm">
              <Package className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">Order</span>
              <span className="font-semibold tracking-wide text-foreground tabular-nums">
                {order.orderNumber}
              </span>
            </p>
            <p className="mt-2 text-xs text-muted-foreground">Placed {placed}</p>
          </div>
        </FadeUp>

        <FadeUp delay={0.05}>
          <div className="mt-8 overflow-hidden rounded-xl border border-border bg-card">
            <ul className="divide-y divide-border">
              {order.items.map((item) => (
                <li
                  key={`${item.productId}:${item.variantId ?? ""}`}
                  className="flex gap-3 p-3"
                >
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
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3 py-3">
              <span className="text-sm font-semibold text-foreground">
                Subtotal ({order.itemCount} item{order.itemCount === 1 ? "" : "s"})
              </span>
              <span className="text-base font-semibold text-foreground tabular-nums">
                {priced ? formatPaise(order.subtotalPaise) : "On confirmation"}
              </span>
            </div>
          </div>
        </FadeUp>

        {/* Frozen GST breakup (proforma) — only for a priced viewer. */}
        {priced && order.tax ? (
          <FadeUp delay={0.07}>
            <div className="mt-4">
              <OrderTaxBreakup tax={order.tax} proforma />
            </div>
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
