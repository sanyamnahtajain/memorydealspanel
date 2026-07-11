import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PAGE_SIZES } from "@/lib/constants";
import { getBrandBySlug, listByBrandForViewer } from "@/server/dal/brands";
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
import { loadMoreBrandProducts } from "./actions";

/**
 * Brand landing page.
 *
 * RENDERING: like the category route, this reads the current viewer (cookies)
 * to unlock live pricing for approved customers, so it is dynamic. It never
 * embeds a price for a gated viewer — the brand-scoped DAL projects prices away
 * and each listing item renders a locked pill.
 *
 * The brand HEADER (name + logo) is fully public — no price ever appears in the
 * header or the SEO metadata by construction.
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
  // NOTE: metadata is price-free by construction.
  return {
    title: `${brand.name} — MemoryDeals`,
    description: `Browse ${brand.name} products in the MemoryDeals wholesale catalogue. Approved buyers unlock live trade pricing.`,
    openGraph: {
      title: `${brand.name} — MemoryDeals`,
      type: "website",
    },
  };
}

export default async function BrandPage({ params }: BrandPageProps) {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) {
    notFound();
  }

  const viewer = await getViewer();
  const products = await listByBrandForViewer(viewer, brand.id, {
    page: 1,
    take: PAGE_SIZES.storefront,
  });

  const items: ListingItem[] = buildListingItems(products, viewer);

  // Wishlist state for the current customer: seeds the header badge count and
  // each product heart's filled state. Empty for anon/admin. Carries no price.
  const wishlistState = await wishlistStateForViewer(viewer);

  // Header cart badge — a count only for an approved customer, else undefined.
  const cartCount = await cartCountForViewer(viewer);

  // Bind the brand id to the load-more action so the client listing only needs
  // to pass the next page number. Price slots stay server-rendered.
  const brandId = brand.id;
  async function loadMore(nextPage: number): Promise<ListingItem[]> {
    "use server";
    return loadMoreBrandProducts(brandId, nextPage);
  }

  return (
    <StorefrontShell wishlistCount={wishlistState.count} cartCount={cartCount}>
      <FadeUp>
        <div className="mt-2 mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1 rounded-full py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-4" aria-hidden />
            All products
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
    </StorefrontShell>
  );
}
