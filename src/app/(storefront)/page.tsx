import { Suspense } from "react";
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
import { ReelsRail } from "@/components/storefront/reels/ReelsRail";
import {
  HomePriceReveal,
  LivePriceSlot,
} from "@/components/storefront/home/LivePriceSlot";
import { BannerCarousel } from "@/components/storefront/home/BannerCarousel";
import { listLiveBanners } from "@/server/services/banners";
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
  const [categories, brands, featured, bestSellerIds, heroBanners] =
    await Promise.all([
    listActive(),
    listActivePublicBrands(),
    listForViewer(ANON_VIEWER, { take: FEATURED_LIMIT }),
    bestSellerProductIds(BEST_SELLER_LIMIT),
    // Global and price-free, so it caches with the ISR shell like every other
    // rail here. Fails to an empty list rather than throwing (see the service).
    listLiveBanners("HOME_HERO"),
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
      {/* Promo banners, first on the page (the Flipkart/Amazon position).
          Renders NOTHING when no banner is live, so the page is byte-identical
          to today's until the owner adds one — the sections below keep their
          order untouched. */}
      {heroBanners.length > 0 ? (
        <div className="mt-3">
          <BannerCarousel banners={heroBanners} />
        </div>
      ) : null}

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
      {/* Section rhythm (HomeSections): category → brand →
          best sellers → reels → trending → new & featured → the dark
          "how it works" panel. Every rail here is rendered for the ANONYMOUS
          viewer — see the module comment. */}
      <HomeSections
        // Without a live banner the category section is the first thing under the
        // header, so the wrapper's banner-clearing top margin would read as an
        // empty band. Tighten it in that case only.
        className={heroBanners.length > 0 ? undefined : "mt-4 md:mt-6"}
      >
        {/* Shop by category — the retailer's #1 jump-off point, first. */}
        <section aria-labelledby="home-categories">
          <SectionHeading
            id="home-categories"
            eyebrow="Browse"
            title="Shop by category"
            subtitle="Jump straight to the shelf you restock most."
            seeAllHref="/categories"
            seeAllLabel="View all"
          />
          {categories.length > 0 ? (
            // Home teaser — 8 tiles on phones, 12 from md (CategoryGrid's
            // teaser rule); the full list lives at /categories.
            <CategoryGrid categories={categories.slice(0, 12)} animated teaser />
          ) : (
            <EmptyState
              illustration="empty-box"
              title="Categories coming soon"
              description="We're organising the catalog — check back shortly."
            />
          )}
        </section>

        {/* Shop by brand — leverages the brand master. One-row rail on
            phones, capped grid on md+, so it never pushes the catalog down. */}
        {brands.length > 0 ? (
          <section aria-labelledby="home-brands">
            <SectionHeading
              id="home-brands"
              eyebrow="Brands we carry"
              title="Shop by brand"
              seeAllHref="/brands"
              seeAllLabel="All brands"
            />
            <BrandShowcase brands={brands} />
          </section>
        ) : null}

        {/* Best sellers — global, price-free (ANON locked pills), identical
            for every visitor: see the comment above bestSellers. Young shop
            with no order signal → no section at all. */}
        {bestSellerItems.length > 0 ? (
          <section aria-labelledby="home-best-sellers">
            <SectionHeading
              id="home-best-sellers"
              eyebrow="Moving fast"
              title="Best sellers"
              subtitle="What retailers reorder most."
            />
            <FeaturedRail items={bestSellerItems} />
          </section>
        ) : null}

        {/* Reels — 9:16 clips that open the full-screen /reels feed. A server
            component reading the price-free reels service; renders NOTHING
            when no reel is live. Own Suspense boundary, like Trending, so a
            slow read never holds the rest of home. */}
        <Suspense fallback={null}>
          <ReelsRail />
        </Suspense>

        {/* Trending now — admin pins first, then the surge algorithm (maths
            in src/lib/trending.ts). A server component that renders ANON
            locked pills into the shared cache; LivePriceSlot upgrades them
            client-side exactly like Best sellers. Renders nothing without
            signal. */}
        {/* OWN Suspense boundary, null fallback: this is the only section that
            fetches mid-stream, and it once held the whole page hostage for
            27 seconds. Whatever it costs, the rest of home no longer waits —
            the rail simply streams in when it is ready. */}
        <Suspense fallback={null}>
          <TrendingRail />
        </Suspense>

        {/* New & featured products (gated pills). Far below the fold now, so
            no eager/priority images — Best sellers owns the LCP slot. */}
        {featuredItems.length > 0 ? (
          <section aria-labelledby="home-featured">
            <SectionHeading
              id="home-featured"
              eyebrow="Just in"
              title="New & featured"
              seeAllHref="/search"
            />
            <FeaturedRail items={featuredItems} priorityImageCount={0} />
          </section>
        ) : null}

        {/* How it works — last: the page's one dark feature panel, the
            explainer kept for visitors who are not approved yet. The panel
            owns its heading (id "home-how"). */}
        <section aria-labelledby="home-how">
          <HowItWorks />
        </section>
      </HomeSections>
      </HomePriceReveal>
    </StorefrontShell>
  );
}
