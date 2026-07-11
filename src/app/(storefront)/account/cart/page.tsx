import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/server/db";
import { resolveViewer } from "@/server/auth/viewer";
import { canSeePrices, isCustomer } from "@/server/types/viewer";
import { getCart, cartCountForViewer } from "@/server/services/cart";
import { APP_NAME } from "@/lib/constants";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { FadeUp } from "@/components/motion/primitives";
import { CartView, type CartLineData } from "./CartView";

/**
 * Cart page (customer-only).
 *
 * SECURITY & GATE:
 *  - IDOR: `getCart` is scoped to the resolved customer viewer — this page can
 *    only ever show the CURRENT customer's own cart (id from the session, never
 *    the URL).
 *  - AUTH: anon/admin viewers are redirected to /account/login. A logged-in but
 *    NOT-approved (pending/expired/blocked) customer sees their saved cart but
 *    the price + place controls are locked — access is re-checked server-side
 *    on every mutation and again at placement, so the lock can't be bypassed.
 *  - PRICE GATE: line prices are computed by `getCart` ONLY when the viewer is
 *    price-authorised; otherwise every `unitPricePaise` is null and no amount is
 *    embedded on the page.
 */
export const metadata: Metadata = {
  title: `Your cart — ${APP_NAME}`,
  robots: { index: false, follow: false },
};

// Per-request session + gated prices; never cache.
export const dynamic = "force-dynamic";

export default async function CartPage() {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    redirect(viewer.kind === "admin" ? "/admin" : "/account/login");
  }

  const cart = await getCart(viewer);
  const canOrder = canSeePrices(viewer);
  // Header cart badge — count only for an approved customer, else undefined.
  const cartCount = await cartCountForViewer(viewer);

  // Resolve slugs for detail links (C1's CartLine omits slug). Only real
  // product ids; a vanished product simply has no slug (non-linked line).
  const productIds = [...new Set(cart.lines.map((l) => l.productId))];
  const slugRows = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, slug: true },
      })
    : [];
  const slugById = new Map(slugRows.map((r) => [r.id, r.slug]));

  const lines: CartLineData[] = cart.lines.map((l) => ({
    productId: l.productId,
    variantId: l.variantId,
    name: l.name,
    sku: l.sku,
    slug: slugById.get(l.productId) ?? null,
    brand: l.brand,
    variantLabel: l.variantLabel,
    imageUrl: l.imageUrl,
    quantity: l.quantity,
    moq: l.moq,
    stockStatus: l.stockStatus,
    unitPricePaise: l.unitPricePaise,
    lineTotalPaise: l.lineTotalPaise,
    available: l.available,
    issues: l.issues,
  }));

  return (
    <StorefrontShell cartCount={cartCount}>
      <div className="mx-auto w-full max-w-5xl py-6 pb-28 sm:py-8 lg:pb-8">
        <FadeUp>
          <PageHeader
            title="Your cart"
            description={
              lines.length > 0
                ? "Review your items and place a purchase request. No payment is taken now."
                : "Items you add while browsing gather here."
            }
            backHref="/account"
            backLabel="Account"
          />
        </FadeUp>

        <div className="mt-6">
          {lines.length === 0 ? (
            <FadeUp delay={0.05}>
              <EmptyState
                illustration="empty-box"
                title="Your cart is empty"
                description="Browse the catalogue and add products to build a purchase request."
                action={
                  <>
                    <Button render={<Link href="/categories" />}>
                      Browse categories
                    </Button>
                    <Button render={<Link href="/search" />} variant="outline">
                      Search products
                    </Button>
                  </>
                }
              />
            </FadeUp>
          ) : (
            <FadeUp delay={0.05}>
              <CartView
                initialLines={lines}
                initialSubtotalPaise={cart.subtotalPaise}
                priced={cart.priced}
                canOrder={canOrder}
              />
            </FadeUp>
          )}
        </div>
      </div>
    </StorefrontShell>
  );
}
