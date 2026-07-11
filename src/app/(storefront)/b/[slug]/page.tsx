import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PAGE_SIZES } from "@/lib/constants";
import {
  getBrandBySlug,
  listByBrandForViewer,
  listBrandCategories,
} from "@/server/dal/brands";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { wishlistStateForViewer } from "@/server/services/wishlist";
import { cartCountForViewer } from "@/server/services/cart";
import { StorefrontShell } from "@/components/shell/StorefrontShell";
import { FadeUp } from "@/components/motion/primitives";
import {
  StorefrontListing,
  buildListingItems,
  type ListingItem,
} from "@/components/storefront/listing";
import { BrandCategoryGrid } from "@/components/storefront/BrandCategoryGrid";
import { SectionHeading } from "@/components/storefront/home";
import { loadMoreBrandProducts } from "./actions";

/**
 * Brand landing page — brand → category → products drill-down.
 *
 * The page LEADS with a category selection (only the categories this brand has
 * products in, each linking to `/b/[brand]/[category]`), and ends with an
 * "All {brand} products" listing as the browse-everything escape hatch.
 *
 * RENDERING: reads the current viewer to unlock live pricing for approved
 * customers, so it is dynamic. It never embeds a price for a gated viewer — the
 * brand-scoped DAL projects prices away and each listing item renders a locked
 * pill. The brand header + category grid + counts are all price-free.
 */
export const dynamic = "force-dynamic";

interface BrandPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({
  params,
}: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) {
    return { title: "Brand not found — MemoryDeals" };
  }
  return {
    title: `${brand.name} — MemoryDeals`,
    description: `Browse ${brand.name} products by category in the MemoryDeals wholesale catalogue. Approved buyers unlock live trade pricing.`,
    openGraph: { title: `${brand.name} — MemoryDeals`, type: "website" },
  };
}

export default async function BrandPage({ params }: BrandPageProps) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) {
    notFound();
  }

  const viewer = await getViewer();
  const [categories, products, wishlistState, cartCount] = await Promise.all([
    listBrandCategories(brand.id),
    listByBrandForViewer(viewer, brand.id, {
      page: 1,
      take: PAGE_SIZES.storefront,
    }),
    wishlistStateForViewer(viewer),
    cartCountForViewer(viewer),
  ]);

  const items: ListingItem[] = buildListingItems(products, viewer);

  const brandId = brand.id;
  async function loadMore(nextPage: number): Promise<ListingItem[]> {
    "use server";
    return loadMoreBrandProducts(brandId, nextPage);
  }

  return (
    <StorefrontShell wishlistCount={wishlistState.count} cartCount={cartCount}>
      <FadeUp>
        <div className="mt-2 mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-full py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-4" aria-hidden />
            Home
          </Link>

          <div className="mt-2 flex items-center gap-3">
            {brand.logo ? (
              <span className="relative size-11 shrink-0 overflow-hidden rounded-lg border border-border bg-white">
                <Image
                  src={brand.logo}
                  alt={`${brand.name} logo`}
                  fill
                  sizes="44px"
                  className="object-contain p-1"
                />
              </span>
            ) : null}
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">
              {brand.name}
            </h1>
          </div>
        </div>
      </FadeUp>

      {/* Category selection — the primary way in. */}
      {categories.length > 0 ? (
        <section aria-labelledby="brand-categories" className="mb-12">
          <SectionHeading
            id="brand-categories"
            title={`Shop ${brand.name} by category`}
          />
          <BrandCategoryGrid brandSlug={slug} categories={categories} />
        </section>
      ) : null}

      {/* Browse everything — the escape hatch at the end. */}
      <section aria-labelledby="brand-all">
        <SectionHeading id="brand-all" title={`All ${brand.name} products`} />
        <StorefrontListing
          initialItems={items}
          loadMore={loadMore}
          pageSize={PAGE_SIZES.storefront}
          initialPage={1}
          canSeePrices={canSeePrices(viewer)}
          emptyTitle={`No ${brand.name} products yet`}
          emptyDescription="We're adding stock for this brand soon — check back shortly."
          savedProductIds={wishlistState.savedProductIds}
        />
      </section>
    </StorefrontShell>
  );
}
