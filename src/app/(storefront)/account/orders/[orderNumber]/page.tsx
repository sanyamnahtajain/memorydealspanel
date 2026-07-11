import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import { getCustomerOrderByNumber } from "@/server/services/admin-orders";
import { cartCountForViewer } from "@/server/services/cart";
import { APP_NAME } from "@/lib/constants";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { FadeUp } from "@/components/motion/primitives";
import { OrderDetailView } from "@/components/storefront/orders/OrderDetailView";
import type {
  OrderHistoryDetail,
  OrderHistoryLine,
} from "@/components/storefront/orders/types";

export const metadata: Metadata = {
  title: `Order — ${APP_NAME}`,
  robots: { index: false, follow: false },
};

// Per-request session state + gated prices; never cache.
export const dynamic = "force-dynamic";

/**
 * Single order detail (customer).
 *
 * OWNERSHIP / IDOR: the order is fetched by `{ customerId, orderNumber }` where
 * `customerId` comes from the session (never the URL). A guessed orderNumber
 * that isn't the viewer's own resolves to nothing → 404. `adminNote` is never
 * selected on this path.
 *
 * PRICE GATE: prices are attached to the snapshot ONLY when
 * `canSeePrices(viewer)`. A lapsed customer sees the structure with prices
 * locked — no amount ever enters the payload for them.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    redirect(viewer.kind === "admin" ? "/admin/orders" : "/account/login");
  }

  const { orderNumber } = await params;
  const decoded = decodeURIComponent(orderNumber);

  const order = await getCustomerOrderByNumber(viewer.customerId, decoded);
  if (!order) {
    notFound();
  }

  const priced = canSeePrices(viewer);

  const items: OrderHistoryLine[] = order.items.map((line) => ({
    productId: line.productId,
    variantId: line.variantId,
    name: line.name,
    sku: line.sku,
    brand: line.brand,
    variantLabel: line.variantLabel,
    imageUrl: line.imageUrl,
    quantity: line.quantity,
    unitPricePaise: priced ? line.unitPricePaise : null,
    lineTotalPaise: priced ? line.lineTotalPaise : null,
  }));

  const detail: OrderHistoryDetail = {
    orderNumber: order.orderNumber,
    status: order.status,
    itemCount: order.itemCount,
    subtotalPaise: priced ? order.subtotalPaise : null,
    placedAt: order.placedAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    note: order.note,
    items,
    priced,
  };

  const cartCount = await cartCountForViewer(viewer);

  return (
    <StorefrontShell cartCount={cartCount}>
      <div className="mx-auto w-full max-w-3xl py-6 sm:py-8">
        <FadeUp>
          <PageHeader
            title="Order details"
            backHref="/account/orders"
            backLabel="Your orders"
          />
        </FadeUp>
        <div className="mt-6">
          <FadeUp delay={0.05}>
            <OrderDetailView detail={detail} />
          </FadeUp>
        </div>
      </div>
    </StorefrontShell>
  );
}
