import type { Metadata } from "next";

import { listActive } from "@/server/dal/categories";
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
  BrandStrip,
  FeaturedRail,
  SectionHeading,
} from "@/components/storefront/home";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";

export const metadata: Metadata = {
  title: `${APP_NAME} — Wholesale mobile accessories`,
  description:
    "Browse The Memory Deals wholesale catalog of mobile accessories — cases, chargers, cables, audio and more. Approved retailers unlock live trade pricing.",
};

/**
 * Home is a PUBLIC, price-free landing page served via ISR. The featured rail
 * is rendered for the ANONYMOUS viewer on purpose: the cached shell must never
 * embed a real price, and locked pills are correct for every visitor sharing a
 * cache entry. Live pricing is unlocked on the category, product and search
 * surfaces, which branch on the real viewer.
 *
 * INTEGRATOR NOTE: to show approved customers live prices on the home teaser,
 * split the featured rail into its own dynamic segment / client fetch — do NOT
 * relax this page's ISR, or a cached anon render could be served to an approved
 * viewer (and vice-versa).
 */
export const revalidate = 300;

const FEATURED_LIMIT = 8;

export default async function HomePage() {
  const [categories, featured] = await Promise.all([
    listActive(),
    listForViewer(ANON_VIEWER, { take: FEATURED_LIMIT }),
  ]);

  const featuredItems: ProductCardItem[] = featured.map((product) => ({
    product,
    // Anon viewer → every slot is a locked "See price" chip. No money crosses
    // into the client, so this is safe to cache in the shared ISR shell.
    priceSlot: renderPriceSlot(product, ANON_VIEWER),
  }));

  return (
    <StorefrontShell>
      <HomeHero />

      <HomeSections>
        <section aria-labelledby="home-how">
          <SectionHeading id="home-how" title="How it works" />
          <HowItWorks />
        </section>

        <section aria-labelledby="home-categories">
          <SectionHeading
            id="home-categories"
            title="Shop by category"
            seeAllHref="/search"
            seeAllLabel="Browse all"
          />
          {categories.length > 0 ? (
            <CategoryGrid categories={categories} />
          ) : (
            <EmptyState
              illustration="empty-box"
              title="Categories coming soon"
              description="We're organising the catalog — check back shortly."
            />
          )}
        </section>

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

        <section aria-labelledby="home-why">
          <SectionHeading id="home-why" title={`Why ${APP_NAME}`} />
          <ValueProps />
        </section>

        <section aria-label={APP_TAGLINE}>
          <BrandStrip />
        </section>
      </HomeSections>
    </StorefrontShell>
  );
}
