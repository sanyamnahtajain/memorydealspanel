import type { Metadata } from "next";

import { listActive } from "@/server/dal/categories";
import { listActivePublicBrands } from "@/server/dal/brands";
import { listForViewer } from "@/server/dal/products";
import { ANON_VIEWER } from "@/server/types/viewer";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { HomeSections } from "@/components/storefront/HomeSections";
import { CategoryGrid } from "@/components/storefront/CategoryGrid";
import { EmptyState } from "@/components/common/EmptyState";
import { renderPriceSlot } from "@/components/storefront/priceSlot";
import type { ProductCardItem } from "@/components/storefront/ProductCardGrid";
import {
  HowItWorks,
  BrandShowcase,
  FeaturedRail,
  SectionHeading,
} from "@/components/storefront/home";
import { BuyAgainRail } from "@/components/storefront/home/BuyAgainRail";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: `${APP_NAME} — Wholesale mobile accessories`,
  description:
    "Browse The Memory Deals wholesale catalog of mobile accessories — cases, chargers, cables, audio and more. Approved retailers unlock live trade pricing.",
};

/**
 * Home is a PUBLIC, price-free landing page served via ISR. The featured rail is
 * rendered for the ANONYMOUS viewer on purpose: the cached shell must never
 * embed a real price, and locked pills are correct for every visitor sharing a
 * cache entry. Live pricing is unlocked on category/product/search surfaces,
 * which branch on the real viewer.
 */
export const revalidate = 300;

const FEATURED_LIMIT = 8;

export default async function HomePage() {
  const [categories, brands, featured] = await Promise.all([
    listActive(),
    listActivePublicBrands(),
    listForViewer(ANON_VIEWER, { take: FEATURED_LIMIT }),
  ]);

  const featuredItems: ProductCardItem[] = featured.map((product) => ({
    product,
    priceSlot: renderPriceSlot(product, ANON_VIEWER),
  }));

  return (
    <StorefrontShell topNotice="Prices are subject to change without prior notice — please confirm current rates before placing your order.">
      {/* "Buy again" — the signed-in customer's own top re-orders, first on
          the page. DO NOT move this into the server render: home is PUBLIC
          ISR (revalidate=300) and must never read cookies or embed anything
          per-viewer. BuyAgainRail is a client component that fetches the
          gated /api/buy-again in the BROWSER and renders NOTHING for anon /
          admin / empty — the personalisation happens client-side so the
          cached shell stays public. It sits OUTSIDE <HomeSections> because
          that wrapper gives every child a stagger slot + space-y gap, which
          would shift the page for logged-out visitors even when the rail is
          empty. */}
      <BuyAgainRail />
      <HomeSections>
        {/* Shop by brand — leverages the brand master; surfaced first. */}
        {brands.length > 0 ? (
          <section aria-labelledby="home-brands">
            <SectionHeading
              id="home-brands"
              title="Shop by brand"
              seeAllHref="/brands"
              seeAllLabel="All brands"
            />
            <BrandShowcase brands={brands} />
          </section>
        ) : null}

        {/* Shop by category — the retailer's #1 jump-off point, high on the page. */}
        <section aria-labelledby="home-categories">
          <SectionHeading
            id="home-categories"
            title="Shop by category"
            seeAllHref="/categories"
            seeAllLabel="View all"
          />
          {categories.length > 0 ? (
            // Home teaser — show a clean set; the full list lives at /categories.
            <CategoryGrid categories={categories.slice(0, 12)} animated />
          ) : (
            <EmptyState
              illustration="empty-box"
              title="Categories coming soon"
              description="We're organising the catalog — check back shortly."
            />
          )}
        </section>

        {/* New & featured products (gated pills). */}
        {featuredItems.length > 0 ? (
          <section aria-labelledby="home-featured">
            <SectionHeading
              id="home-featured"
              title="New & featured"
              seeAllHref="/search"
            />
            <FeaturedRail items={featuredItems} />
          </section>
        ) : null}

        {/* How it works — conversion for first-time visitors. */}
        <section aria-labelledby="home-how">
          <SectionHeading id="home-how" title="How it works" />
          <HowItWorks />
        </section>

      </HomeSections>
    </StorefrontShell>
  );
}
