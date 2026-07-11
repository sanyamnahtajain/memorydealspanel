import type { Metadata } from "next";

import { prisma } from "@/server/db";
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
  HomeHero,
  HowItWorks,
  ValueProps,
  BrandShowcase,
  StatsBar,
  HomeCTA,
  FeaturedRail,
  SectionHeading,
} from "@/components/storefront/home";
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
  const [categories, brands, featured, productCount] = await Promise.all([
    listActive(),
    listActivePublicBrands(),
    listForViewer(ANON_VIEWER, { take: FEATURED_LIMIT }),
    prisma.product.count({ where: { status: "ACTIVE", deletedAt: null } }),
  ]);

  const featuredItems: ProductCardItem[] = featured.map((product) => ({
    product,
    priceSlot: renderPriceSlot(product, ANON_VIEWER),
  }));

  // Category names seed the hero's "popular" search chips.
  const suggestions = categories.slice(0, 5).map((c) => c.name);

  return (
    <StorefrontShell>
      <HomeSections>
        {/* Stats strip — immediate sense of catalogue scale. */}
        <StatsBar
          products={productCount}
          brands={brands.length}
          categories={categories.length}
        />

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

        {/* Why us — trust. */}
        <section aria-labelledby="home-why">
          <SectionHeading id="home-why" title={`Why ${APP_NAME}`} />
          <ValueProps />
        </section>

        {/* Pitch + integrated search + CTAs — moved below the catalogue so the
            brand/category grids lead the page. */}
        <HomeHero suggestions={suggestions} />

        {/* Closing call-to-action. */}
        <HomeCTA />
      </HomeSections>
    </StorefrontShell>
  );
}
