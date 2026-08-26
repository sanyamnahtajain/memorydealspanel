import type { Metadata } from "next";

import { listActive } from "@/server/dal/categories";
import { listActivePublicBrands } from "@/server/dal/brands";
import { listForViewer, listByIdsForViewer } from "@/server/dal/products";
import { bestSellerProductIds } from "@/server/services/recommendations";
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
import { TrendingRail } from "@/components/storefront/home/TrendingRail";
import {
  HomePriceReveal,
  LivePriceSlot,
} from "@/components/storefront/home/LivePriceSlot";
import { BuyAgainRail } from "@/components/storefront/home/BuyAgainRail";
import { LastOrderCard } from "@/components/storefront/home/LastOrderCard";
import { APP_NAME } from "@/lib/constants";

export const metadata: Metadata = {
  title: `${APP_NAME} — Wholesale mobile accessories`,
  description:
    "Browse The Memory Deals wholesale catalog of mobile accessories — cases, chargers, cables, audio and more. Approved retailers unlock live trade pricing.",
};

/**
 * Home is a PUBLIC, price-free working tool served via ISR — the page a
 * retailer opens every day: their own re-orders first, the shop's best
 * sellers and trending movers, then the catalog jump-off points. (Search
 * lives in the shell header — the owner cut the in-page search bar.) Every server-rendered rail
 * uses the ANONYMOUS viewer on purpose: the cached shell must never embed a
 * real price, and locked pills are correct for every visitor sharing a cache
 * entry. Live pricing is unlocked on category/product/search surfaces, which
 * branch on the real viewer. Personalisation on THIS page happens only in
 * client components (LastOrderCard, BuyAgainRail) that fetch gated APIs in
 * the browser and render nothing for anon.
 */
export const revalidate = 300;

const FEATURED_LIMIT = 8;
const BEST_SELLER_LIMIT = 8;

export default async function HomePage() {
  const [categories, brands, featured, bestSellerIds] = await Promise.all([
    listActive(),
    listActivePublicBrands(),
    listForViewer(ANON_VIEWER, { take: FEATURED_LIMIT }),
    bestSellerProductIds(BEST_SELLER_LIMIT),
  ]);

  // Best sellers — the shop's recency-weighted top movers, resolved through
  // the gated DAL read (ranking preserved, hidden products drop out). Safe to
  // render INSIDE the ISR shell: the ranking is GLOBAL (built from all orders,
  // not the viewer's), the slots are ANON locked pills, and the section is
  // therefore byte-identical for every visitor sharing a cache entry.
  const bestSellers =
    bestSellerIds.length > 0
      ? await listByIdsForViewer(ANON_VIEWER, bestSellerIds)
      : [];

  const bestSellerItems: ProductCardItem[] = bestSellers.map((product) => ({
    product,
    // Anon pill in the cached shell; LivePriceSlot swaps in the real label
    // client-side for entitled viewers (see LivePriceSlot.tsx).
    priceSlot: (
      <LivePriceSlot productId={product.id}>
        {renderPriceSlot(product, ANON_VIEWER)}
      </LivePriceSlot>
    ),
  }));

  // OWNER RULE: New & featured is a discovery shelf — no price cell at all
  // (no pill, no "See price", no lock). Price lives one tap away on the PDP.
  const featuredItems: ProductCardItem[] = featured.map((product) => ({
    product,
    priceSlot: null,
  }));

  return (
    <StorefrontShell topNotice="Prices are subject to change without prior notice — please confirm current rates before placing your order.">
      {/* "Your last order" + "Buy again" — the signed-in customer's own data,
          right under search. DO NOT move these into the server render: home is
          PUBLIC ISR (revalidate=300) and must never read cookies or embed
          anything per-viewer. Both are client components that fetch gated APIs
          (/api/last-order, /api/buy-again) in the BROWSER and render NOTHING
          for anon / admin / empty — the personalisation happens client-side so
          the cached shell stays public. They sit OUTSIDE <HomeSections>
          because that wrapper gives every child a stagger slot + space-y gap,
          which would shift the page for logged-out visitors even when they are
          empty. */}
      <LastOrderCard />
      <BuyAgainRail />

      <HomePriceReveal>
      <HomeSections>
        {/* Shop by brand — leverages the brand master. */}
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

        {/* Shop by category — the retailer's #1 jump-off point. */}
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

        {/* Best sellers — global, price-free (ANON locked pills), identical
            for every visitor: see the comment above bestSellers. Young shop
            with no order signal → no section at all. */}
        {bestSellerItems.length > 0 ? (
          <section aria-labelledby="home-best-sellers">
            <SectionHeading id="home-best-sellers" title="Best sellers" />
            <FeaturedRail items={bestSellerItems} />
          </section>
        ) : null}

        {/* Trending now — admin pins first, then the surge algorithm (maths
            in src/lib/trending.ts). A server component that renders ANON
            locked pills into the shared cache; LivePriceSlot upgrades them
            client-side exactly like Best sellers. Renders nothing without
            signal. */}
        <TrendingRail />

        {/* New & featured products (gated pills). Far below the fold now, so
            no eager/priority images — Best sellers owns the LCP slot. */}
        {featuredItems.length > 0 ? (
          <section aria-labelledby="home-featured">
            <SectionHeading
              id="home-featured"
              title="New & featured"
              seeAllHref="/search"
            />
            <FeaturedRail items={featuredItems} priorityImageCount={0} />
          </section>
        ) : null}

        {/* How it works — last, compact and quiet: the one explainer kept for
            visitors who are not approved yet. */}
        <section aria-labelledby="home-how">
          <SectionHeading id="home-how" title="How it works" />
          <HowItWorks />
        </section>
      </HomeSections>
      </HomePriceReveal>
    </StorefrontShell>
  );
}
