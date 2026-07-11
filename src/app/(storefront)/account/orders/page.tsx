import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import {
  countCustomerOrders,
  listCustomerOrders,
} from "@/server/services/admin-orders";
import { cartCountForViewer } from "@/server/services/cart";
import { APP_NAME, PAGE_SIZES } from "@/lib/constants";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Pager } from "@/components/common/Pager";
import { Button } from "@/components/ui/button";
import { FadeUp } from "@/components/motion/primitives";
import { OrderHistoryList } from "@/components/storefront/orders/OrderHistoryList";
import type { OrderHistoryRow } from "@/components/storefront/orders/types";

/**
 * Order history (customer). Lists ONLY the resolved viewer's own orders —
 * `listCustomerOrders` is scoped to `viewer.customerId` (from the session,
 * never the URL), so this page can never surface another customer's orders.
 *
 * PRICE GATE: totals are shown only when `canSeePrices(viewer)`; a lapsed
 * customer sees their orders with totals hidden (no amount in the payload).
 */
export const metadata: Metadata = {
  title: `Your orders — ${APP_NAME}`,
  robots: { index: false, follow: false },
};

// Per-request session state + gated prices; never cache.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    redirect(viewer.kind === "admin" ? "/admin/orders" : "/account/login");
  }

  const params = await searchParams;
  const parsedPage = Number(params.page ?? "1");
  const page =
    Number.isFinite(parsedPage) && parsedPage > 0 ? Math.trunc(parsedPage) : 1;

  const priced = canSeePrices(viewer);
  const take = Math.min(PAGE_SIZE, PAGE_SIZES.max);

  const [items, total] = await Promise.all([
    listCustomerOrders(viewer.customerId, {
      take,
      skip: (page - 1) * take,
    }),
    countCustomerOrders(viewer.customerId),
  ]);

  const orders: OrderHistoryRow[] = items.map((o) => ({
    orderNumber: o.orderNumber,
    status: o.status,
    itemCount: o.itemCount,
    subtotalPaise: priced ? o.subtotalPaise : null,
    placedAt: o.placedAt.toISOString(),
  }));

  const pageCount = Math.max(1, Math.ceil(total / take));

  // Header cart badge — count only for an approved customer, else undefined.
  const cartCount = await cartCountForViewer(viewer);

  return (
    <StorefrontShell cartCount={cartCount}>
      <div className="mx-auto w-full max-w-3xl py-6 sm:py-8">
        <FadeUp>
          <PageHeader
            title="Your orders"
            description={
              total > 0
                ? "Your purchase requests. Open one to see items, track progress, or reorder."
                : "Orders you place will appear here."
            }
            backHref="/account"
            backLabel="Account"
          />
        </FadeUp>

        <div className="mt-6 space-y-6">
          {orders.length === 0 ? (
            <FadeUp delay={0.05}>
              <EmptyState
                illustration="empty-box"
                title="No orders yet"
                description="Add products to your cart and place a request — it'll show up here so you can track and reorder."
                action={
                  <>
                    <Button render={<Link href="/categories" />}>
                      Browse categories
                    </Button>
                    <Button render={<Link href="/account/cart" />} variant="outline">
                      View cart
                    </Button>
                  </>
                }
              />
            </FadeUp>
          ) : (
            <>
              <FadeUp delay={0.05}>
                <OrderHistoryList orders={orders} />
              </FadeUp>
              <Pager
                page={page}
                pageCount={pageCount}
                total={total}
                pageSize={take}
              />
            </>
          )}
        </div>
      </div>
    </StorefrontShell>
  );
}
