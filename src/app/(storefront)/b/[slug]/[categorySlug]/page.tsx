import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PAGE_SIZES } from "@/lib/constants";
import { getBrandBySlug, listByBrandForViewer } from "@/server/dal/brands";
import { getBySlug } from "@/server/dal/categories";
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

/**
 * Brand → Category → Products: the leaf of the drill-down. Lists the products
 * that are BOTH this brand AND this category, viewer-gated (no price for a
 * gated viewer). Reached from the brand landing page's category grid.
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string; categorySlug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug, categorySlug } = await params;
  const [brand, category] = await Promise.all([
    getBrandBySlug(slug),
    getBySlug(categorySlug),
  ]);
  if (!brand || !category) {
    return { title: "Not found — MemoryDeals" };
  }
  return {
    title: `${brand.name} ${category.name} — MemoryDeals`,
    description: `Browse ${brand.name} ${category.name} in the MemoryDeals wholesale catalogue. Approved buyers unlock live trade pricing.`,
    robots: { index: false, follow: true },
  };
}

export default async function BrandCategoryPage({ params }: PageProps) {
  const { slug, categorySlug } = await params;
  const [brand, category] = await Promise.all([
    getBrandBySlug(slug),
    getBySlug(categorySlug),
  ]);
  if (!brand || !category) {
    notFound();
  }

  const viewer = await getViewer();
  const [products, wishlistState, cartCount] = await Promise.all([
    listByBrandForViewer(viewer, brand.id, {
      categoryId: category.id,
      page: 1,
      take: PAGE_SIZES.storefront,
    }),
    wishlistStateForViewer(viewer),
    cartCountForViewer(viewer),
  ]);

  const items: ListingItem[] = buildListingItems(products, viewer);

  const brandId = brand.id;
  const categoryId = category.id;
  async function loadMore(nextPage: number): Promise<ListingItem[]> {
    "use server";
    const page = Math.max(1, Math.trunc(nextPage));
    const v = await getViewer();
    const rows = await listByBrandForViewer(v, brandId, {
      categoryId,
      page,
      take: PAGE_SIZES.storefront,
    });
    return buildListingItems(rows, v);
  }

  return (
    <StorefrontShell wishlistCount={wishlistState.count} cartCount={cartCount}>
      <FadeUp>
        <div className="mt-2 mb-5">
          <Link
            href={`/b/${slug}`}
            className="inline-flex items-center gap-1 rounded-full py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {brand.name}
          </Link>

          <div className="mt-2 flex items-center gap-3">
            {brand.logo ? (
              <span className="relative size-10 shrink-0 overflow-hidden rounded-lg border border-border bg-white">
                <Image
                  src={brand.logo}
                  alt={`${brand.name} logo`}
                  fill
                  sizes="40px"
                  className="object-contain p-1"
                />
              </span>
            ) : null}
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {brand.name}
              </p>
              <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                {category.name}
              </h1>
            </div>
          </div>
        </div>
      </FadeUp>

      <StorefrontListing
        initialItems={items}
        loadMore={loadMore}
        pageSize={PAGE_SIZES.storefront}
        initialPage={1}
        canSeePrices={canSeePrices(viewer)}
        emptyTitle={`No ${brand.name} ${category.name} yet`}
        emptyDescription="We're adding stock for this brand and category soon — check back shortly."
        savedProductIds={wishlistState.savedProductIds}
      />
    </StorefrontShell>
  );
}
