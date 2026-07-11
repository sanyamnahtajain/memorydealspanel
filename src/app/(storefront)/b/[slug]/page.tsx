import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { PAGE_SIZES } from "@/lib/constants";
import { getBrandBySlug, listBrandCategories } from "@/server/dal/brands";
import { getViewer } from "@/server/auth/viewer";
import { canSeePrices } from "@/server/types/viewer";
import { discoverProducts } from "@/server/storefront/discovery";
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
import { DiscoveryFilters } from "@/components/storefront/filters";
import {
  loadFacetData,
  selectionToDiscoverParams,
  toDiscoverSort,
} from "@/components/storefront/filters/adapter";
import { parseSelection } from "@/components/storefront/filters/types";

/**
 * Brand landing — brand → category → products, WITH faceted filters.
 *
 * Multi-category brands lead with a category drill-down; every brand then gets
 * an "All {brand} products" listing scoped to the brand and filterable by the
 * same facets as /search (category / spec / stock / tag, and — approved only —
 * a price band). The brand scope is fixed server-side, so filters only ever
 * narrow WITHIN the brand. Price gate intact (gated viewers get locked pills).
 */
export const dynamic = "force-dynamic";

interface BrandPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function toSearchParams(
  raw: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value)) for (const v of value) params.append(key, v);
    else if (typeof value === "string") params.append(key, value);
  }
  return params;
}

export async function generateMetadata({
  params,
}: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  const brand = await getBrandBySlug(slug);
  if (!brand) return { title: "Brand not found — MemoryDeals" };
  return {
    title: `${brand.name} — MemoryDeals`,
    description: `Browse ${brand.name} products by category in the MemoryDeals wholesale catalogue. Approved buyers unlock live trade pricing.`,
    openGraph: { title: `${brand.name} — MemoryDeals`, type: "website" },
  };
}

export default async function BrandPage({
  params,
  searchParams,
}: BrandPageProps) {
  const { slug } = await params;
  const raw = await searchParams;
  const brand = await getBrandBySlug(slug);
  if (!brand) notFound();

  const viewer = await getViewer();
  const approved = canSeePrices(viewer);
  const urlParams = toSearchParams(raw);
  const selection = parseSelection(urlParams, approved);
  const sort = toDiscoverSort(urlParams.get("sort"));
  const brandIds = [brand.id];

  const [categories, facets, firstPage, wishlistState, cartCount] =
    await Promise.all([
      listBrandCategories(brand.id),
      loadFacetData(viewer, { brandIds }),
      discoverProducts(viewer, {
        ...selectionToDiscoverParams(selection, {
          approved,
          sort,
          limit: PAGE_SIZES.storefront,
        }),
        brandIds,
      }),
      wishlistStateForViewer(viewer),
      cartCountForViewer(viewer),
    ]);

  const items: ListingItem[] = buildListingItems(firstPage.items, viewer);

  const selectionSnapshot = selection;
  const sortSnapshot = sort;
  async function loadMore(nextPage: number): Promise<ListingItem[]> {
    "use server";
    const page = Math.max(1, Math.trunc(nextPage));
    const v = await getViewer();
    const result = await discoverProducts(v, {
      ...selectionToDiscoverParams(selectionSnapshot, {
        approved: canSeePrices(v),
        sort: sortSnapshot,
        limit: page * PAGE_SIZES.storefront,
      }),
      brandIds,
    });
    return buildListingItems(
      result.items.slice((page - 1) * PAGE_SIZES.storefront),
      v,
    );
  }

  return (
    <StorefrontShell wishlistCount={wishlistState.count} cartCount={cartCount}>
      <FadeUp>
        <div className="mt-2 mb-6">
          <Link
            href="/brands"
            className="inline-flex items-center gap-1 rounded-full py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <ChevronLeft className="size-4" aria-hidden />
            All brands
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

      {/* Category drill-down — only worth showing when the brand spans >1. */}
      {categories.length > 1 ? (
        <section aria-labelledby="brand-categories" className="mb-10">
          <SectionHeading
            id="brand-categories"
            title={`Shop ${brand.name} by category`}
          />
          <BrandCategoryGrid brandSlug={slug} categories={categories} />
        </section>
      ) : null}

      {/* Filterable product listing, scoped to the brand. */}
      <section aria-labelledby="brand-all">
        <SectionHeading id="brand-all" title={`All ${brand.name} products`} />
        <DiscoveryFilters facets={facets} resultCount={firstPage.total}>
          <StorefrontListing
            initialItems={items}
            loadMore={loadMore}
            pageSize={PAGE_SIZES.storefront}
            initialPage={1}
            canSeePrices={approved}
            total={firstPage.total}
            emptyTitle={`No ${brand.name} products match`}
            emptyDescription="Try clearing a filter, or check back as we add stock."
            savedProductIds={wishlistState.savedProductIds}
          />
        </DiscoveryFilters>
      </section>
    </StorefrontShell>
  );
}
