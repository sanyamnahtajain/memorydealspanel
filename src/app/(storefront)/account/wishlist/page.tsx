import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { resolveViewer } from "@/server/auth/viewer";
import { isCustomer } from "@/server/types/viewer";
import { listWishlist, wishlistCount } from "@/server/services/wishlist";
import { cartCountForViewer } from "@/server/services/cart";
import { APP_NAME } from "@/lib/constants";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { Button } from "@/components/ui/button";
import { FadeUp } from "@/components/motion/primitives";
import { renderPriceSlot } from "@/components/storefront/priceSlot";
import { buildWhatsAppEnquiryLink } from "@/components/storefront/product";
import { WishlistGrid, type WishlistCardData } from "./WishlistCard";

/**
 * Wishlist / saved products page (customer-only).
 *
 * SECURITY & GATE:
 *  - IDOR: `listWishlist` / `wishlistCount` are scoped to the resolved
 *    customer viewer — this page can only ever show the CURRENT customer's own
 *    saved products (the id comes from the session, never the URL).
 *  - AUTH: anon/admin viewers are redirected to /account/login — guests can't
 *    have a wishlist. Any authenticated customer (including PENDING) may build
 *    one while awaiting approval.
 *  - PRICE GATE: each card's price is a SERVER-rendered `renderPriceSlot` node
 *    (real price only for an approved viewer; the locked chip otherwise), so no
 *    amount is embedded for a non-approved viewer anywhere on this page.
 */
export const metadata: Metadata = {
  title: `Your wishlist — ${APP_NAME}`,
  robots: { index: false, follow: false },
};

// Per-request session state + gated prices; never cache.
export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const viewer = await resolveViewer();
  if (!isCustomer(viewer)) {
    // Admins have no personal wishlist; anon must sign in first.
    redirect(viewer.kind === "admin" ? "/admin" : "/account/login");
  }

  const [entries, total, cartCount] = await Promise.all([
    listWishlist(viewer),
    wishlistCount(viewer.customerId),
    cartCountForViewer(viewer),
  ]);

  // Build the client-safe card data. The price node is rendered HERE on the
  // server through the gate, so the client component never sees an amount.
  const items: WishlistCardData[] = entries.map((entry) => {
    const p = entry.product;
    const image = p.images.find((img) => img.isPrimary) ?? p.images[0] ?? null;
    return {
      productId: p.id,
      slug: p.slug,
      name: p.name,
      sku: p.sku,
      brandName: p.brandRef?.name ?? p.brand ?? null,
      brandSlug: p.brandRef?.slug ?? null,
      imageUrl: image ? image.thumbUrl ?? image.url : null,
      moq: p.moq,
      stockStatus: p.stockStatus,
      note: entry.note,
      enquireHref: buildWhatsAppEnquiryLink({
        productName: p.name,
        sku: p.sku,
      }),
      priceSlot: renderPriceSlot(p, viewer, "md"),
    };
  });

  return (
    <StorefrontShell wishlistCount={total} cartCount={cartCount}>
      <div className="mx-auto w-full max-w-5xl py-6 sm:py-8">
        <FadeUp>
          <PageHeader
            title="Your wishlist"
            description={
              items.length > 0
                ? "Products you've saved. Enquire on WhatsApp, view details, or remove any you no longer need."
                : "Save products as you browse and they'll gather here."
            }
            backHref="/account"
            backLabel="Account"
          />
        </FadeUp>

        <div className="mt-6">
          {items.length === 0 ? (
            <FadeUp delay={0.05}>
              <EmptyState
                illustration="empty-box"
                title="Nothing saved yet"
                description="Browse the catalogue and tap the heart on any product to save it here for later."
                action={
                  <>
                    <Button render={<Link href="/categories" />}>
                      Browse categories
                    </Button>
                    <Button
                      render={<Link href="/search" />}
                      variant="outline"
                    >
                      Search products
                    </Button>
                  </>
                }
              />
            </FadeUp>
          ) : (
            <FadeUp delay={0.05}>
              <WishlistGrid items={items} totalCount={total} />
            </FadeUp>
          )}
        </div>
      </div>
    </StorefrontShell>
  );
}
